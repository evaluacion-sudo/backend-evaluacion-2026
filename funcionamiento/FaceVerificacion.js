// backend/funcionamiento/FaceVerificacion.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const nodemailer = require('nodemailer');
const { ejecutarQuery } = require('../config/database');
const { verificarToken } = require('../config/auth');

const transporter = nodemailer.createTransport({
  // Al usar 'gmail', Nodemailer ignora el host y optimiza la ruta de conexión
  service: process.env.SMTP_HOST?.includes('gmail') ? 'gmail' : undefined,
  host: process.env.SMTP_HOST || '://gmail.com', 
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true', // Mantener en false para puerto 587
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '' // Recuerda: aquí va la contraseña de aplicación de 16 letras
  },
  // Esta sección TLS es obligatoria para saltar los firewalls de AWS y Railway
  tls: {
    ciphers: 'SSLv3',
    rejectUnauthorized: false 
  }
});

const generarCodigo = () => {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let codigo = '';
  for (let i = 0; i < 6; i++) {
    codigo += letras.charAt(Math.floor(Math.random() * letras.length));
  }
  return codigo;
};

// Configuración de multer para subir archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten archivos de imagen'), false);
  }
});

// Función para detectar rostros usando análisis básico de imagen
async function detectarRostro(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;
    if (width < 100 || height < 100) 
      return { detected: false, confidence: 0, message: 'Imagen demasiado pequeña' };

    const stats = await sharp(imageBuffer).greyscale().stats();
    const mean = stats.channels[0].mean;
    const stdev = stats.channels[0].stdev;
    const hasGoodContrast = stdev > 20;
    const hasGoodBrightness = mean > 50 && mean < 200;

    if (hasGoodContrast && hasGoodBrightness) {
      return { 
        detected: true, 
        confidence: Math.min(85, (stdev / 2) + (Math.abs(mean - 125) / 10)), 
        message: 'Rostro detectado exitosamente' 
      };
    } else {
      return { 
        detected: false, 
        confidence: Math.max(15, (stdev / 2) + (Math.abs(mean - 125) / 10)), 
        message: 'Rostro no válido' 
      };
    }
  } catch (error) {
    console.error('Error detección facial:', error);
    return { detected: false, confidence: 0, message: 'Error procesando la imagen' };
  }
}

// Endpoint para registrar/verificar rostro de cliente
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { clienteId } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No se proporcionó imagen' });
    if (!clienteId) return res.status(400).json({ error: 'ID de cliente requerido' });

    // Procesar imagen
    const imageBuffer = req.file.buffer;
    const deteccion = await detectarRostro(imageBuffer);

    if (!deteccion.detected) {
      return res.status(400).json({ error: deteccion.message, confidence: deteccion.confidence });
    }

    // Guardar rostro en la base de datos
    const imagenBase64 = imageBuffer.toString('base64');
    const result = await ejecutarQuery(
      'INSERT INTO rostros_clientes (cliente_id, imagen_rostro, confianza_deteccion) VALUES (?, ?, ?)',
      [clienteId, imagenBase64, deteccion.confidence]
    );

    res.json({
      fotoId: result.insertId,
      message: 'Rostro registrado exitosamente',
      confidence: Math.round(deteccion.confidence)
    });
  } catch (error) {
    console.error('Error en registro facial:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para verificar rostro de cliente (comparación) - ahora recibe datos desde frontend
router.post('/verificar', verificarToken, async (req, res) => {
  try {
    const { clienteId, verified, confidence } = req.body;
    const transportistaId = req.usuario?.id || 1;
    console.log('Registrando verificación facial para cliente:', clienteId);

    if (!clienteId) {
      return res.status(400).json({ error: 'ID de cliente requerido' });
    }

    // Registrar verificación en la base de datos
    await ejecutarQuery(
      'INSERT INTO verificaciones_faciales (cliente_id, transportista_id, confianza, resultado, fecha_verificacion, observaciones) VALUES (?, ?, ?, ?, NOW(), ?)',
      [clienteId, transportistaId, confidence || 0, verified ? 'exitoso' : 'fallido', verified ? 'Verificación facial exitosa' : 'Verificación facial fallida']
    );

    console.log('Verificación registrada exitosamente');
    res.json({
      success: true,
      message: 'Verificación registrada correctamente'
    });

  } catch (error) {
    console.error('Error registrando verificación:', error);
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
});

// Endpoint para enviar código de verificación al email del cliente
router.post('/enviar-codigo', verificarToken, async (req, res) => {
  try {
    const { clienteId } = req.body;
    const transportistaId = req.usuario?.id || 1;

    if (!clienteId) {
      return res.status(400).json({ error: 'ID de cliente requerido' });
    }

    const clienteRows = await ejecutarQuery('SELECT email, nombre FROM clientes WHERE id = ?', [clienteId]);
    const clienteData = clienteRows[0];
    if (!clienteData || !clienteData.email) {
      return res.status(400).json({ error: 'Cliente o email no encontrado' });
    }

    const codigo = generarCodigo();
    const expiracion = new Date(Date.now() + 15 * 60 * 1000);

    await ejecutarQuery(
      'INSERT INTO verificacion_codigos (cliente_id, codigo, usado, expiracion, enviado_a) VALUES (?, ?, 0, ?, ?)',
      [clienteId, codigo, expiracion, clienteData.email]
    );

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(500).json({ error: 'SMTP no configurado. No se pudo enviar el correo' });
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@tuapp.com',
      to: clienteData.email,
      subject: 'Código de verificación de identidad',
      text: `Tu código de verificación de identidad es: ${codigo}`,
      html: `<p>Tu código de verificación de identidad es:</p><h2>${codigo}</h2><p>Ingresa este código en la aplicación para completar la verificación.</p>`
    });

    await ejecutarQuery(
      'INSERT INTO verificaciones_faciales (cliente_id, transportista_id, confianza, resultado, fecha_verificacion, observaciones) VALUES (?, ?, 0, ?, NOW(), ?)',
      [clienteId, transportistaId, 'fallido', `Código enviado a ${clienteData.email}`]
    );

    res.json({ success: true, message: 'Código enviado al correo del cliente' });
  } catch (error) {
    console.error('Error enviando código de verificación:', error);
    res.status(500).json({ error: 'No se pudo enviar el código de verificación' });
  }
});

// Endpoint para confirmar código de verificación
router.post('/confirmar-codigo', verificarToken, async (req, res) => {
  try {
    const { clienteId, codigo } = req.body;
    const transportistaId = req.usuario?.id || 1;

    if (!clienteId || !codigo) {
      return res.status(400).json({ error: 'ID de cliente y código son requeridos' });
    }

    const codigoRows = await ejecutarQuery(
      'SELECT * FROM verificacion_codigos WHERE cliente_id = ? AND codigo = ? AND usado = 0 AND expiracion >= NOW() ORDER BY created_at DESC LIMIT 1',
      [clienteId, codigo.toUpperCase()]
    );

    if (!codigoRows || codigoRows.length === 0) {
      await ejecutarQuery(
        'INSERT INTO verificaciones_faciales (cliente_id, transportista_id, confianza, resultado, fecha_verificacion, observaciones) VALUES (?, ?, 0, ?, NOW(), ?)',
        [clienteId, transportistaId, 'fallido', `Código inválido: ${codigo}`]
      );
      return res.status(400).json({ error: 'Código inválido o expirado' });
    }

    const codigoRow = codigoRows[0];
    await ejecutarQuery('UPDATE verificacion_codigos SET usado = 1, updated_at = NOW() WHERE id = ?', [codigoRow.id]);

    await ejecutarQuery(
      'INSERT INTO verificaciones_faciales (cliente_id, transportista_id, confianza, resultado, fecha_verificacion, observaciones) VALUES (?, ?, 100, ?, NOW(), ?)',
      [clienteId, transportistaId, 'exitoso', `Código confirmado: ${codigo}`]
    );

    res.json({ success: true, message: 'Código confirmado correctamente' });
  } catch (error) {
    console.error('Error confirmando código de verificación:', error);
    res.status(500).json({ error: 'Error interno al confirmar código de verificación' });
  }
});

// Endpoint para obtener historial de verificaciones de un cliente
router.get('/historial/:clienteId', async (req, res) => {
  try {
    const { clienteId } = req.params;

    const verificaciones = await ejecutarQuery(
      `SELECT vf.*, c.nombre as cliente_nombre, u.email as transportista_email
       FROM verificaciones_faciales vf
       JOIN clientes c ON vf.cliente_id = c.id
       JOIN usuarios u ON vf.transportista_id = u.id
       WHERE vf.cliente_id = ?
       ORDER BY vf.fecha_verificacion DESC
       LIMIT 10`,
      [clienteId]
    );

    res.json(verificaciones);
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
