// backend/funcionamiento/clientes.js
const express = require("express");
const router = express.Router();
const { db, ejecutarQuery } = require("../config/database");
const { verificarToken, verificarRol } = require("../config/auth");
const { registrarEvento } = require('./trazabilidad');

// -------------------------
// Crear nuevo cliente
// -------------------------
router.post('/', verificarToken, async (req, res) => {
  const { nombre, direccion, contacto, email, pedido_json, fotoId, latitud, longitud } = req.body;

  // Validamos campos obligatorios
  if (!nombre || !direccion || !contacto || !email || !pedido_json || !Array.isArray(pedido_json) || pedido_json.length === 0) {
    return res.status(400).json({
      mensaje: "Nombre, direccion, contacto, email y pedido_json (array no vacío) requeridos"
    });
  }

  // Validar email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ mensaje: "Email inválido" });
  }

  // Validar contacto chileno: +56 + exactamente 9 dígitos
  const telefonoRegex = /^\+56\d{9}$/;
  if (!telefonoRegex.test(contacto)) {
    return res.status(400).json({ 
      mensaje: "Teléfono debe ser +569xxxxxxxx (9 dígitos numéricos después de +56)" 
    });
  }

  // Validar dirección mínima
  if (direccion.length < 5) {
    return res.status(400).json({ mensaje: "Dirección muy corta" });
  }

  try {
    // Parse y validar pedido (JSON array)
    const pedidoItems = pedido_json.map(item => {
      const cantidad = parseInt(item.cantidad);
      if (!item.nombre || isNaN(cantidad) || cantidad <= 0) {
        throw new Error(`Item inválido: ${item.nombre}`);
      }
      return item;
    });

    // Validar stock disponible y restar
    for (const item of pedidoItems) {
      const stockCheck = await ejecutarQuery(
        'SELECT stock_disponible FROM almacen WHERE id = ? AND stock_disponible >= ? FOR UPDATE',
        [item.id, item.cantidad]
      );
      if (stockCheck.length === 0) {
        return res.status(400).json({ mensaje: `Stock insuficiente para ${item.nombre}` });
      }
      // Restar stock
      await ejecutarQuery(
        'UPDATE almacen SET stock_disponible = stock_disponible - ? WHERE id = ?',
        [item.cantidad, item.id]
      );
    }

    // Insert cliente
    const pedidoTexto = JSON.stringify(pedidoItems);
    db.query(
      'INSERT INTO clientes (nombre, direccion, contacto, email, pedido, foto_id, latitud, longitud) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [nombre, direccion, contacto, email, pedidoTexto, fotoId || null, latitud || null, longitud || null],
      (err, result) => {
        if (err) {
          // Log detallado para diagnóstico y rollback simplificado
          console.error('Error DB al insertar cliente:', err);
          return res.status(500).json({ mensaje: "Error al crear cliente", detalle: err.message });
        }
        registrarEvento({
          tipo: 'cliente_creado',
          descripcion: `Se registró al cliente ${nombre} y su pedido`,
          actor: req.usuario || null,
          entidadTipo: 'cliente',
          entidadId: result.insertId,
          entidadNombre: nombre,
          detalle: {
            direccion,
            contacto,
            email,
            pedido: pedidoItems
          }
        });
        res.status(201).json({
          id: result.insertId,
          nombre,
          direccion,
          contacto,
          email,
          pedidoItems,
          fotoId: fotoId || null,
          latitud: latitud || null,
          longitud: longitud || null,
          mensaje: "Cliente creado correctamente con validaciones"
        });
      }
    );
  } catch (error) {
    console.error('Error POST cliente:', error);
    res.status(400).json({ mensaje: error.message || "Error de validación stock/pedido" });
  }
});

// -------------------------
// Obtener todos los clientes
// -------------------------
router.get("/", (req, res) => {
  db.query(`
    SELECT c.*, u.email as transportista_email
    FROM clientes c
    LEFT JOIN usuarios u ON c.transportista_id = u.id
  `, (err, results) => {
    if (err) {
      return res.status(500).json({
        mensaje: "Error al obtener los clientes",
      });
    }
    res.json(results);
  });
});

// -------------------------
// Actualizar estado del cliente (solo avance irreversible a 'entregado')
// -------------------------
router.put("/:id/estado", verificarToken, (req, res) => {
  console.log("🔧 PUT /api/clientes/:id/estado - Versión actualizada");
  const clienteId = req.params.id;
  const { estado } = req.body || {};

  // Solo permitimos marcar como 'entregado'
  if (estado !== "entregado") {
    return res.status(400).json({ error: "Transición de estado no permitida" });
  }

  // Verificar estado actual
  db.query("SELECT estado FROM clientes WHERE id = ?", [clienteId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!results || results.length === 0) return res.status(404).json({ error: "Cliente no encontrado" });

    const estadoActual = results[0].estado;
    if (estadoActual === "entregado") {
      // Ya entregado, idempotente: responder 200 para no generar errores en UI
      return res.json({ id: Number(clienteId), estado: "entregado", yaEntregado: true });
    }

    db.query(
      "UPDATE clientes SET estado = 'entregado' WHERE id = ?",
      [clienteId],
      (updateErr) => {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        registrarEvento({
          tipo: 'cliente_entregado',
          descripcion: `Se marcó como entregado al cliente #${clienteId}`,
          actor: req.usuario || null,
          entidadTipo: 'cliente',
          entidadId: Number(clienteId),
          entidadNombre: `Cliente #${clienteId}`,
          detalle: { estado: 'entregado' }
        });
        res.json({ id: Number(clienteId), estado: "entregado" });
      }
    );
  });
});

// -------------------------
// Asignar transportista a un cliente
// -------------------------
router.put("/:id/transportista", verificarToken, (req, res) => {
  const clienteId = req.params.id;
  const { transportista_id } = req.body;

  if (transportista_id === undefined) {
    return res.status(400).json({ error: "transportista_id es requerido" });
  }

  db.query(
    "UPDATE clientes SET transportista_id = ? WHERE id = ?",
    [transportista_id, clienteId],
    (err, result) => {
      if (err) {
        console.error('Error al asignar transportista:', err);
        return res.status(500).json({ error: "Error al asignar transportista" });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Cliente no encontrado" });
      }
      registrarEvento({
        tipo: 'transportista_asignado',
        descripcion: `Se asignó un transportista al cliente #${clienteId}`,
        actor: req.usuario || null,
        entidadTipo: 'cliente',
        entidadId: Number(clienteId),
        entidadNombre: `Cliente #${clienteId}`,
        detalle: { transportista_id: Number(transportista_id) }
      });
      res.json({ message: "Transportista asignado correctamente" });
    }
  );
});

// -------------------------
// Eliminar un cliente
// -------------------------
router.delete("/:id", verificarToken, (req, res) => {
  db.query("DELETE FROM clientes WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(204).end();
  });
});

module.exports = router;
