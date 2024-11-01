// /config/logger.js
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
         winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            level: 'info',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple(),
                winston.format.printf(({ level, message, timestamp, stack, ...metadata }) => {
                    let msg = `${timestamp} [${level}] : ${message}`;
                     if (stack) {
                                            msg += `\n${stack}`;
                                        }
                    if (Object.keys(metadata).length > 0) {
                        msg += `\nMetadata: ${JSON.stringify(metadata, null, 2)}`;
                    }
                    return msg;
                })
            )
        }),
        new winston.transports.File({
            filename: 'error.log',
            level: 'error'
        })
    ]
});

module.exports = logger;