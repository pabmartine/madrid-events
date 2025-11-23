const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const cache = require('../service/cache');
const CoordinateUtils = require('../utils/coordinatesUtils');

router.get('/', async (req, res) => {
    try {
        const { lat, lon } = req.query;

        if (!CoordinateUtils.validateCoordinates(lat, lon)) {
            return res.status(400).json({
                error: 'Invalid latitude or longitude'
            });
        }

        logger.info('Recalculate coordinates request', { lat, lon });
        const newLat = parseFloat(lat);
        const newLon = parseFloat(lon);

        const currentLat = global.baseLat ?? newLat;
        const currentLon = global.baseLon ?? newLon;

        if (newLat.toFixed(2) !== currentLat.toFixed(2) || newLon.toFixed(2) !== currentLon.toFixed(2)) {
            if (typeof global.updateBaseCoordinates === 'function') {
                global.updateBaseCoordinates(newLat, newLon);
            } else {
                global.baseLat = newLat;
                global.baseLon = newLon;
            }

            logger.info('Recalculating distances with new coordinates', {
                baseLat: global.baseLat,
                baseLon: global.baseLon
            });

            if (typeof global.fetchAndStoreEvents !== 'function') {
                logger.error('fetchAndStoreEvents is not initialized');
                return res.status(503).json({
                    error: 'Event refresh service not available'
                });
            }

            await global.fetchAndStoreEvents();
            cache.clearPattern('events:');

            res.json({
                message: 'Recalculation completed with new coordinates',
                baseLat: global.baseLat,
                baseLon: global.baseLon
            });
        } else {
            res.status(400).json({
                message: 'Coordinates are the same, no recalculation needed',
                baseLat: global.baseLat,
                baseLon: global.baseLon
            });
        }
    } catch (error) {
        logger.error('Error in recalculate service:', error.message);
        res.status(500).json({
            error: 'An error occurred during recalculation',
            details: error.message
        });
    }
});

module.exports = router;
