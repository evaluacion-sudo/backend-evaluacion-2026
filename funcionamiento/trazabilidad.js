const express = require("express");
const router = express.Router();
const { ejecutarQuery } = require("../config/database");
const { verificarToken, verificarRol } = require("../config/auth");

async function registrarEvento({
  tipo,
  descripcion,
  actor = {},
  entidadTipo = null,
  entidadId = null,
  entidadNombre = null,
  detalle = {}
}) {
  try {
    const actorId = actor?.id ?? null;
    const actorEmail = actor?.email ?? null;
    const actorNombre = actor?.nombre ?? actorEmail ?? null;
    const detalleJson = detalle && Object.keys(detalle).length > 0 ? JSON.stringify(detalle) : null;

    await ejecutarQuery(
      `
        INSERT INTO trazabilidad_eventos
        (tipo, descripcion, actor_id, actor_email, actor_nombre, entidad_tipo, entidad_id, entidad_nombre, detalle_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        tipo,
        descripcion,
        actorId,
        actorEmail,
        actorNombre,
        entidadTipo,
        entidadId,
        entidadNombre,
        detalleJson
      ]
    );
  } catch (error) {
    console.error("Error registrando trazabilidad:", error);
  }
}

router.get("/", verificarToken, verificarRol(['administrador']), async (req, res) => {
  try {
    const { tipo, usuario, fechaDesde, fechaHasta, busqueda } = req.query;

    let sql = `
      SELECT *
      FROM trazabilidad_eventos
      WHERE 1 = 1
    `;
    const params = [];

    if (tipo) {
      sql += ` AND tipo = ?`;
      params.push(tipo);
    }

    if (usuario) {
      sql += ` AND (
        actor_email LIKE ? OR
        actor_nombre LIKE ? OR
        entidad_nombre LIKE ? OR
        descripcion LIKE ?
      )`;
      const likeValue = `%${usuario}%`;
      params.push(likeValue, likeValue, likeValue, likeValue);
    }

    if (fechaDesde) {
      sql += ` AND created_at >= ?`;
      params.push(`${fechaDesde} 00:00:00`);
    }

    if (fechaHasta) {
      sql += ` AND created_at <= ?`;
      params.push(`${fechaHasta} 23:59:59`);
    }

    if (busqueda) {
      sql += ` AND (
        descripcion LIKE ? OR
        entidad_nombre LIKE ? OR
        actor_email LIKE ? OR
        detalle_json LIKE ?
      )`;
      const likeValue = `%${busqueda}%`;
      params.push(likeValue, likeValue, likeValue, likeValue);
    }

    sql += ` ORDER BY created_at DESC`;

    const eventos = await ejecutarQuery(sql, params);

    const eventosFormateados = eventos.map((evento) => ({
      ...evento,
      detalle: evento.detalle_json ? JSON.parse(evento.detalle_json) : null
    }));

    res.json(eventosFormateados);
  } catch (error) {
    console.error("Error GET trazabilidad:", error);
    res.status(500).json({ mensaje: "Error al obtener la trazabilidad" });
  }
});

module.exports = router;
module.exports.registrarEvento = registrarEvento;
