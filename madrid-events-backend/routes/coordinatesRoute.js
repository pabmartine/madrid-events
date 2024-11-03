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
        const newLat = parseFloat(lat).toFixed(2);
        const newLon = parseFloat(lon).toFixed(2);

        if (newLat !== global.baseLat.toFixed(2) || newLon !== global.baseLon.toFixed(2)) {
            global.baseLat = lat;
            global.baseLon = lon;

            logger.info('Recalculating distances with new coordinates', {
                baseLat: global.baseLat,
                baseLon: global.baseLon
            });

            await fetchAndStoreEvents();
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