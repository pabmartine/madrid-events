const express = require('express');
const router = express.Router();
const database = require('../service/database');
const cache = require('../service/cache');
const logger = require('../config/logger');

router.get('/', async (req, res) => {
    const payload = {
        status: 'ok',
        timestamp: new Date().toISOString()
    };

    try {
        await database.getDb();
        payload.database = 'ok';
    } catch (error) {
        logger.error('Database health check failed', { error: error.message });
        payload.database = 'error';
        payload.databaseError = error.message;
        payload.status = 'degraded';
    }

    payload.cache = cache.getStats();

    if (typeof global.getQueueStats === 'function') {
        payload.queues = global.getQueueStats();
    }

    payload.eventsFetchInProgress = !!global.isEventsFetchInProgress;

    const statusCode = payload.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(payload);
});

module.exports = router;
