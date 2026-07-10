const mysql = require("mysql2");
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "leica666",
  database: process.env.DB_NAME || "proyectotitulo",
  port: Number(process.env.DB_PORT || 3306),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};



// Crear conexión
const db = mysql.createConnection(dbConfig);

// Conectar a la base de datos
db.connect((err) => {
  if (err) {
    console.error("Error de conexión a MySQL:", err);
  } else {
    console.log("Conectado a MySQL!");
    console.log(`Base de datos: ${dbConfig.database}`);
    // Inicializar tablas automáticamente
    inicializarTablas();
  }
});

// Función para inicializar todas las tablas necesarias
async function inicializarTablas() {
  try {
    // Crear base de datos si no existe
    await ejecutarQuery(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    await ejecutarQuery(`USE ${dbConfig.database}`);

    // Tabla de usuarios
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(100) NOT NULL,
        rol ENUM('administrador', 'transportista') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Tabla de clientes
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS clientes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        direccion VARCHAR(255) NOT NULL,
        contacto VARCHAR(50) NOT NULL,
        email VARCHAR(100) DEFAULT NULL,
        pedido TEXT NOT NULL,
        foto_id VARCHAR(255) DEFAULT NULL,
        latitud DECIMAL(10, 8) DEFAULT NULL,
        longitud DECIMAL(11, 8) DEFAULT NULL,
        estado ENUM('pendiente', 'en_ruta', 'entregado') DEFAULT 'pendiente',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Asegurar columna 'email' en clientes (para bases ya creadas)
    try {
      const colEmail = await ejecutarQuery(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'email'`,
        [dbConfig.database]
      );
      if (!colEmail || !colEmail[0] || Number(colEmail[0].cnt) === 0) {
        await ejecutarQuery(
          `ALTER TABLE clientes ADD COLUMN email VARCHAR(100) DEFAULT NULL`
        );
        console.log("✅ Columna 'email' agregada a 'clientes'");
      }
    } catch (e) {
      console.warn("No fue posible verificar/agregar columna 'email' en 'clientes':", e.message);
    }

    // Asegurar columnas 'latitud' y 'longitud' en clientes (para bases ya creadas)
    try {
      const colLat = await ejecutarQuery(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'latitud'`,
        [dbConfig.database]
      );
      const colLng = await ejecutarQuery(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'longitud'`,
        [dbConfig.database]
      );

      if (!colLat || !colLat[0] || Number(colLat[0].cnt) === 0 || !colLng || !colLng[0] || Number(colLng[0].cnt) === 0) {
        // Agregar las columnas que falten
        const alters = [];
        if (!colLat || !colLat[0] || Number(colLat[0].cnt) === 0) alters.push(`ADD COLUMN latitud DECIMAL(10, 8) DEFAULT NULL`);
        if (!colLng || !colLng[0] || Number(colLng[0].cnt) === 0) alters.push(`ADD COLUMN longitud DECIMAL(11, 8) DEFAULT NULL`);
        if (alters.length > 0) {
          await ejecutarQuery(`ALTER TABLE clientes ${alters.join(', ')}`);
          console.log("✅ Columnas 'latitud'/'longitud' agregadas a 'clientes'");
        }
      }
    } catch (e) {
      console.warn("No fue posible verificar/agregar columnas 'latitud'/'longitud' en 'clientes':", e.message);
    }

    // Asegurar columna 'estado' en clientes (para bases ya creadas)
    try {
      const col = await ejecutarQuery(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'estado'`,
        [dbConfig.database]
      );
      if (!col || !col[0] || Number(col[0].cnt) === 0) {
        await ejecutarQuery(
          `ALTER TABLE clientes ADD COLUMN estado ENUM('pendiente','en_ruta','entregado') DEFAULT 'pendiente'`
        );
        console.log("✅ Columna 'estado' agregada a 'clientes'");
      }
    } catch (e) {
      console.warn("No fue posible verificar/agregar columna 'estado' en 'clientes':", e.message);
    }

    // Asegurar columna 'transportista_id' en clientes (para bases ya creadas)
    try {
      const colTransportista = await ejecutarQuery(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'transportista_id'`,
        [dbConfig.database]
      );
      if (!colTransportista || !colTransportista[0] || Number(colTransportista[0].cnt) === 0) {
        await ejecutarQuery(
          `ALTER TABLE clientes ADD COLUMN transportista_id INT DEFAULT NULL, ADD FOREIGN KEY (transportista_id) REFERENCES usuarios(id) ON DELETE SET NULL`
        );
        console.log("✅ Columna 'transportista_id' agregada a 'clientes'");
      }
    } catch (e) {
      console.warn("No fue posible verificar/agregar columna 'transportista_id' en 'clientes':", e.message);
    }

    // Tabla de rutas
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS rutas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        descripcion TEXT,
        transportista_id INT,
        estado ENUM('activa', 'completada', 'cancelada') DEFAULT 'activa',
        fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fecha_fin TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (transportista_id) REFERENCES usuarios(id) ON DELETE SET NULL
      )
    `);

    // Tabla de detalles de ruta
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS detalles_ruta (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ruta_id INT NOT NULL,
        cliente_id INT NOT NULL,
        orden_entrega INT NOT NULL,
        estado ENUM('pendiente', 'en_camino', 'entregado') DEFAULT 'pendiente',
        fecha_entrega TIMESTAMP NULL,
        observaciones TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (ruta_id) REFERENCES rutas(id) ON DELETE CASCADE,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
      )
    `);

    // Tabla de ubicaciones GPS del transportista
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS ubicaciones_transportista (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transportista_id INT NOT NULL,
        latitud DECIMAL(10, 8) NOT NULL,
        longitud DECIMAL(11, 8) NOT NULL,
        velocidad DECIMAL(5, 2) DEFAULT 0,
        direccion VARCHAR(255),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (transportista_id) REFERENCES usuarios(id) ON DELETE CASCADE
      )
    `);



    // Tabla de rostros de clientes
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS rostros_clientes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL UNIQUE,
        imagen_rostro LONGTEXT NOT NULL,
        confianza_deteccion DECIMAL(5, 2) NOT NULL,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
      )
    `);

    // Tabla de verificaciones faciales
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS verificaciones_faciales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        transportista_id INT NOT NULL,
        confianza DECIMAL(5, 2) NOT NULL,
        resultado ENUM('exitoso', 'fallido') NOT NULL,
        fecha_verificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        observaciones TEXT,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
        FOREIGN KEY (transportista_id) REFERENCES usuarios(id) ON DELETE CASCADE
      )
    `);

    // Tabla de códigos de verificación secundaria
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS verificacion_codigos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        codigo VARCHAR(6) NOT NULL,
        usado TINYINT(1) NOT NULL DEFAULT 0,
        expiracion TIMESTAMP NOT NULL,
        enviado_a VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
      )
    `);

// Tabla ALMACÉN/INVENTARIO
    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS almacen (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        descripcion TEXT,
        stock_disponible INT NOT NULL DEFAULT 0,
        stock_minimo INT DEFAULT 0,
        unidad_medida VARCHAR(20) DEFAULT 'unidad',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Tabla 'almacen' creada/actualizada");

    await ejecutarQuery(`
      CREATE TABLE IF NOT EXISTS trazabilidad_eventos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(50) NOT NULL,
        descripcion TEXT NOT NULL,
        actor_id INT DEFAULT NULL,
        actor_email VARCHAR(100) DEFAULT NULL,
        actor_nombre VARCHAR(100) DEFAULT NULL,
        entidad_tipo VARCHAR(50) DEFAULT NULL,
        entidad_id INT DEFAULT NULL,
        entidad_nombre VARCHAR(150) DEFAULT NULL,
        detalle_json TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_trazabilidad_tipo (tipo),
        INDEX idx_trazabilidad_fecha (created_at),
        INDEX idx_trazabilidad_actor (actor_id)
      )
    `);
    console.log("✅ Tabla 'trazabilidad_eventos' creada/actualizada");

    // Insertar usuario por defecto si no existe
    const defaultAdminPassword = bcrypt.hashSync('leica666', 10);
    await ejecutarQuery(`
      INSERT IGNORE INTO usuarios (email, password, rol)
      VALUES ('matias.vp232@gmail.com', ?, 'administrador')
    `, [defaultAdminPassword]);

    console.log("✅ Todas las tablas han sido inicializadas correctamente");

  } catch (error) {
    console.error("❌ Error inicializando tablas:", error);
  }
}

// Función helper para ejecutar queries
function ejecutarQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
}

// Función para crear tablas dinámicamente basadas en componentes
async function crearTablaDesdeComponente(nombreComponente, campos) {
  try {
    const nombreTabla = nombreComponente.toLowerCase().replace('componente', '');
    
    let sql = `CREATE TABLE IF NOT EXISTS ${nombreTabla} (`;
    sql += `id INT AUTO_INCREMENT PRIMARY KEY, `;
    
    campos.forEach((campo, index) => {
      sql += `${campo.nombre} ${campo.tipo}`;
      if (campo.requerido) sql += ' NOT NULL';
      if (campo.default) sql += ` DEFAULT ${campo.default}`;
      if (index < campos.length - 1) sql += ', ';
    });
    
    sql += `, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, `;
    sql += `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`;
    
    await ejecutarQuery(sql);
    console.log(`✅ Tabla ${nombreTabla} creada/actualizada desde componente ${nombreComponente}`);
  } catch (error) {
    console.error(`❌ Error creando tabla desde componente ${nombreComponente}:`, error);
  }
}

module.exports = {
  db,
  ejecutarQuery,
  crearTablaDesdeComponente,
  inicializarTablas
};
