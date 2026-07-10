require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const clientes_router = require('./funcionamiento/clientecomponentes');
const clientes = require('./funcionamiento/clientes');
const registroFacialRouter = require('./funcionamiento/RegistroFacial');
const loginRouter = require('./funcionamiento/login');
const detallespedidos = require('./funcionamiento/detallespedidos');
const faceVerificacionRouter = require('./funcionamiento/FaceVerificacion'); // ✅ NUEVO
const uploadFotoRouter = require('./funcionamiento/uploadFoto'); // ✅ NUEVO
const transportistasRouter = require('./funcionamiento/transportistas'); // ✅ NUEVO
const ubicacionesTransportistaRouter = require('./funcionamiento/ubicacionesTransportista'); // ✅ NUEVO
const almacenRouter = require('./funcionamiento/almacen'); // ✅ ALMACÉN NUEVO
const trazabilidadRouter = require('./funcionamiento/trazabilidad'); // ✅ TRAZABILIDAD NUEVA

const app = express();

// test Configuración CORS - Allow all origins for now to debug
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Middlewares
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));


// Rutas de API
app.use('/api/clientes_componentes', clientes_router);
app.use("/api/clientes", clientes);
app.use("/api/detallespedidos", detallespedidos);
app.use("/api/login", loginRouter);
app.use('/api/registro-facial', registroFacialRouter);
app.use('/api/faceverificacion', faceVerificacionRouter); // ✅ NUEVO
app.use('/api/upload-foto', uploadFotoRouter); // ✅ NUEVO
app.use('/api/transportistas', transportistasRouter); // ✅ NUEVO
app.use('/api/ubicaciones-transportista', ubicacionesTransportistaRouter); // ✅ NUEVO
app.use('/api/almacen', almacenRouter); // ✅ ALMACÉN
app.use('/api/trazabilidad', trazabilidadRouter); // ✅ TRAZABILIDAD

const PORT = process.env.PORT || 3000; //Railway usará el PORT que asigne, si no, usa 3000 (LOCAL)
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor backend corriendo en el puerto ${PORT}`);
        });
