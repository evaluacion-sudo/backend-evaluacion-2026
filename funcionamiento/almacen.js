const express = require("express");
const router = express.Router();
const { db, ejecutarQuery } = require("../config/database");
const { verificarToken, verificarRol } = require("../config/auth");
const { registrarEvento } = require('./trazabilidad');

// GET /api/almacen - Listar todos
router.get("/", verificarToken, async (req, res) => {
  try {
    const resultados = await ejecutarQuery("SELECT * FROM almacen ORDER BY nombre");
    res.json(resultados);
  } catch (error) {
    console.error("Error GET almacen:", error);
    res.status(500).json({ mensaje: "Error al obtener inventario" });
  }
});

// POST /api/almacen - Crear nuevo item
router.post("/", verificarToken, verificarRol('administrador'), async (req, res) => {
const { nombre, descripcion, stock_disponible, unidad_medida } = req.body;

  if (!nombre || stock_disponible === undefined || stock_disponible < 0) {
    return res.status(400).json({ mensaje: "Nombre y stock válido requeridos" });
  }

  try {
    const result = await ejecutarQuery(
"INSERT INTO almacen (nombre, descripcion, stock_disponible, unidad_medida) VALUES (?, ?, ?, ?)",
[nombre, descripcion || '', stock_disponible, unidad_medida || 'unidad']
    );
    const nuevoItem = { id: result.insertId, ...req.body };
    await registrarEvento({
      tipo: 'producto_creado',
      descripcion: `Se agregó el producto ${nombre} al almacén`,
      actor: req.usuario || null,
      entidadTipo: 'almacen',
      entidadId: nuevoItem.id,
      entidadNombre: nombre,
      detalle: {
        stock_inicial: Number(stock_disponible),
        unidad_medida: unidad_medida || 'unidad',
        descripcion: descripcion || ''
      }
    });
    res.status(201).json(nuevoItem);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ mensaje: "Item ya existe" });
    }
    console.error("Error POST almacen:", error);
    res.status(500).json({ mensaje: "Error al crear item" });
  }
});

// PUT /api/almacen/:id - Actualizar (stock o datos)
router.put("/:id", verificarToken, verificarRol('administrador'), async (req, res) => {
  const id = req.params.id;
  const cambios = req.body;
const camposValidos = ['nombre', 'descripcion', 'stock_disponible', 'unidad_medida'];

  const camposUpdate = Object.keys(cambios).filter(c => camposValidos.includes(c));
  if (cambios.stock_disponible !== undefined && cambios.stock_disponible < 0) {
    return res.status(400).json({ mensaje: "Stock no puede ser negativo" });
  }

  if (camposUpdate.length === 0) {
    return res.status(400).json({ mensaje: "Datos para actualizar requeridos" });
  }

  const sets = camposUpdate.map(campo => `${campo} = ?`).join(', ');
  const valores = camposUpdate.map(campo => cambios[campo]);
  valores.push(id);

  try {
    const result = await ejecutarQuery(`UPDATE almacen SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, valores);
    if (result.affectedRows === 0) {
      return res.status(404).json({ mensaje: "Item no encontrado" });
    }
    if (cambios.stock_disponible !== undefined) {
      await registrarEvento({
        tipo: 'stock_actualizado',
        descripcion: `Se actualizó el stock del producto ${id}`,
        actor: req.usuario || null,
        entidadTipo: 'almacen',
        entidadId: Number(id),
        entidadNombre: `Producto #${id}`,
        detalle: { stock_nuevo: Number(cambios.stock_disponible) }
      });
    }
    res.json({ mensaje: "Item actualizado", id: Number(id) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ mensaje: "Nombre ya existe" });
    }
    console.error("Error PUT almacen:", error);
    res.status(500).json({ mensaje: "Error al actualizar item" });
  }
});

// DELETE /api/almacen/:id
router.delete("/:id", verificarToken, verificarRol('administrador'), async (req, res) => {
  try {
    const result = await ejecutarQuery("DELETE FROM almacen WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ mensaje: "Item no encontrado" });
    }
    res.json({ mensaje: "Item eliminado" });
  } catch (error) {
    console.error("Error DELETE almacen:", error);
    res.status(500).json({ mensaje: "Error al eliminar item" });
  }
});

// GET /api/almacen/disponibles - Solo items con stock > 0 para pedidos
router.get("/disponibles", verificarToken, async (req, res) => {
  try {
    const resultados = await ejecutarQuery("SELECT * FROM almacen WHERE stock_disponible > 0 ORDER BY nombre");
    res.json(resultados);
  } catch (error) {
    console.error("Error GET disponibles:", error);
    res.status(500).json({ mensaje: "Error al obtener items disponibles" });
  }
});

// GET /api/almacen/:id - Stock individual (realtime para pedidos)
router.get("/:id", verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await ejecutarQuery("SELECT * FROM almacen WHERE id = ?", [id]);
    if (result.length === 0) {
      return res.status(404).json({ mensaje: "Item no encontrado" });
    }
    res.json(result[0]);
  } catch (error) {
    console.error("Error GET almacen/:id:", error);
    res.status(500).json({ mensaje: "Error al obtener stock" });
  }
});

module.exports = router;

