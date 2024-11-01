// config/cors.js
const cors = require('cors');
const constants = require('./constants');
const logger = require('../utils/logger');

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir peticiones sin origin (como las de Postman)
        if (!origin) {
            return callback(null, true);
        }

        const allowedOrigins = constants.FRONTEND_URL.split(',').map(url => url.trim());

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            logger.warn('Origin blocked by CORS', { origin, allowedOrigins });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true, // Permitir credenciales
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
};

module.exports = cors(corsOptions);