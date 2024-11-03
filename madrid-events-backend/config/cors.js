const cors = require('cors');
const constants = require('./constants');
const logger = require('../config/logger');

const corsOptions = {
    origin: function (origin, callback) {
        logger.debug('CORS - Request received', {
            origin,
            configuredOrigins: constants.FRONTEND_URL,
            allowedOrigins: constants.FRONTEND_URL ? constants.FRONTEND_URL.split(',').map(url => url.trim()) : []
        });

        // Permitir peticiones sin origin (como las de Postman o desarrollo local)
        if (!origin) {
            logger.debug('CORS - Allowing request without origin');
            return callback(null, true);
        }

        // Si no hay FRONTEND_URL configurado, permitir todo en desarrollo
        if (!constants.FRONTEND_URL) {
            logger.warn('CORS - No FRONTEND_URL configured, allowing all origins in development');
            return callback(null, true);
        }

        const allowedOrigins = constants.FRONTEND_URL.split(',').map(url => url.trim());

        if (allowedOrigins.indexOf(origin) !== -1) {
            logger.debug('CORS - Origin allowed', { origin });
            callback(null, true);
        } else {
            logger.warn('CORS - Origin blocked', {
                origin,
                allowedOrigins,
                message: 'Origin not in allowedOrigins list'
            });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
};

// Crear middleware con manejo de errores
const corsMiddleware = cors(corsOptions);

// Wrapper para mejor manejo de errores
const enhancedCors = (req, res, next) => {
    corsMiddleware(req, res, (err) => {
        if (err) {
            logger.error('CORS Error:', {
                error: err.message,
                origin: req.headers.origin,
                method: req.method,
                path: req.path
            });
            res.status(403).json({
                error: 'CORS error',
                message: 'Not allowed by CORS',
                allowedOrigins: constants.FRONTEND_URL ? constants.FRONTEND_URL.split(',').map(url => url.trim()) : []
            });
        } else {
            next();
        }
    });
};

module.exports = enhancedCors;