const logger = require('../utils/logger');

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    logger.error(err.stack);

    res.status(500).json({
        error: 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? err.message : 'No additional details available'
    });
};

module.exports = errorHandler;