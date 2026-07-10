const express = require("express");
const router = express.Router();
const { db, ejecutarQuery } = require("../config/database");

// POST - Guardar ubicación del transportista
router.post("/", async (req, res) => {
  try {
    const { transportista_id, latitud, longitud, velocidad, direccion } = req.body;

    if (!transportista_id || latitud === undefined || longitud === undefined) {
      return res.status(400).json({ error: "Faltan campos requeridos: transportista_id, latitud, longitud" });
    }

    const sql = `
      INSERT INTO ubicaciones_transportista (transportista_id, latitud, longitud, velocidad, direccion, timestamp)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;

    const result = await ejecutarQuery(sql, [transportista_id, latitud, longitud, velocidad || 0, direccion || '']);

    res.status(201).json({
      mensaje: "Ubicación guardada exitosamente",
      id: result.insertId
    });
  } catch (error) {
    console.error("Error guardando ubicación:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET - Obtener historial de ubicaciones de un transportista
router.get("/historial/:transportista_id", async (req, res) => {
  try {
    const { transportista_id } = req.params;
    const { limite = 50 } = req.query;

    const sql = `
      SELECT id, transportista_id, latitud, longitud, velocidad, direccion, timestamp
      FROM ubicaciones_transportista
      WHERE transportista_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    const results = await ejecutarQuery(sql, [transportista_id, parseInt(limite)]);
    res.json(results);
  } catch (error) {
    console.error("Error obteniendo historial de ubicaciones:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET - Obtener última ubicación de un transportista
router.get("/ultima/:transportista_id", async (req, res) => {
  try {
    const { transportista_id } = req.params;

    const sql = `
      SELECT id, transportista_id, latitud, longitud, velocidad, direccion, timestamp
      FROM ubicaciones_transportista
      WHERE transportista_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const results = await ejecutarQuery(sql, [transportista_id]);

    if (results.length === 0) {
      return res.status(404).json({ error: "No se encontró ubicación para este transportista" });
    }

    res.json(results[0]);
  } catch (error) {
    console.error("Error obteniendo última ubicación:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET - Obtener ubicaciones recientes de todos los transportistas (para admin)
router.get("/recientes", async (req, res) => {
  try {
    const { limite = 100 } = req.query;

    const sql = `
      SELECT ut.*, u.email as transportista_email
      FROM ubicaciones_transportista ut
      JOIN usuarios u ON ut.transportista_id = u.id
      ORDER BY ut.timestamp DESC
      LIMIT ?
    `;

    const results = await ejecutarQuery(sql, [parseInt(limite)]);
    res.json(results);
  } catch (error) {
    console.error("Error obteniendo ubicaciones recientes:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET - Obtener ubicaciones de transportistas asignados a pedidos del usuario
router.get("/asignados", async (req, res) => {
  try {
    // Obtener usuario del token JWT
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET );
    const usuario = decoded;

    let transportistaIds = [];

    if (usuario.rol === 'administrador' || usuario.rol === 'admin') {
      // Admin ve todas las ubicaciones recientes
      const sql = `\n        SELECT DISTINCT ut.transportista_id\n        FROM ubicaciones_transportista ut\n      `;
      const transportistas = await ejecutarQuery(sql);
      transportistaIds = transportistas.map(t => t.transportista_id);
    } else if (usuario.rol === 'cliente') {
      // Cliente ve ubicaciones de transportistas asignados a sus pedidos
      const sql = `
        SELECT DISTINCT c.transportista_id
        FROM clientes c
        WHERE c.transportista_id IS NOT NULL
        AND c.usuario_id = ?
      `;
      const transportistas = await ejecutarQuery(sql, [usuario.id]);
      transportistaIds = transportistas.map(t => t.transportista_id).filter(id => id !== null);
    } else if (usuario.rol === 'transportista') {
      // Transportista ve su propia ubicación
      transportistaIds = [usuario.id];
    } else {
      return res.status(403).json({ error: "Rol no autorizado para ver ubicaciones" });
    }

    if (transportistaIds.length === 0) {
      return res.json([]);
    }

    // Obtener últimas ubicaciones de los transportistas filtrados
    const placeholders = transportistaIds.map(() => '?').join(',');
    const sql = `
      SELECT ut.*, u.email as transportista_email
      FROM ubicaciones_transportista ut
      JOIN usuarios u ON ut.transportista_id = u.id
      WHERE ut.transportista_id IN (${placeholders})
      AND ut.timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
      ORDER BY ut.transportista_id, ut.timestamp DESC
    `;

    const allLocations = await ejecutarQuery(sql, transportistaIds);

    // Obtener solo la ubicación más reciente por transportista
    const latestLocations = {};
    allLocations.forEach(location => {
      if (!latestLocations[location.transportista_id]) {
        latestLocations[location.transportista_id] = location;
      }
    });

    const results = Object.values(latestLocations);
    res.json(results);
  } catch (error) {
    console.error("Error obteniendo ubicaciones asignadas:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
