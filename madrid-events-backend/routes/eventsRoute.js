const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const database = require('../service/database');
const cache = require('../service/cache');
const constants = require('../config/constants');

router.get('/', async (req, res) => {
    try {
        const { distrito_nombre, barrio_nombre } = req.query;

        const cachedEvents = await cache.getEvents(distrito_nombre, barrio_nombre);
        if (cachedEvents) {
            return res.json(cachedEvents);
        }

        const db = await database.getDb();
        const collection = db.collection(constants.COLLECTION_NAME);

        let query = {};
        if (distrito_nombre) query.distrito = distrito_nombre;
        if (barrio_nombre) query.barrio = barrio_nombre;

        const eventsData = await collection.find(query).toArray();
        cache.setEvents(eventsData, distrito_nombre, barrio_nombre);

        res.json(eventsData);
    } catch (error) {
        logger.error('Error fetching events:', error.message);
        res.status(500).json({
            error: 'An error occurred while fetching events',
            details: error.message
        });
    }
});

module.exports = router;