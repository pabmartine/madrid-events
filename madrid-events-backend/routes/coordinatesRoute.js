const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const cache = require('../service/cache');
const CoordinateUtils = require('../utils/coordinatesUtils');
const database = require('../service/database');
const constants = require('../config/constants');
const DatabaseUtils = require('../utils/databaseUtils');

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

        if (newLat !== currentLat || newLon !== currentLon) {
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

            const db = await database.getDb();
            await DatabaseUtils.recalculateDistances(
                db,
                constants.COLLECTION_NAME,
                global.baseLat,
                global.baseLon
            );
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
