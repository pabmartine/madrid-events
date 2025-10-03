const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const database = require('../service/database');
const cache = require('../service/cache');
const constants = require('../config/constants');

// Endpoint to get events with optional filters
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

// New endpoint for full-text search
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string' || q.trim() === '') {
            return res.status(400).json({ error: 'Search query \'q\' is required and must be a non-empty string.' });
        }

        const searchTerm = q.trim();
        const cacheKey = `search:${searchTerm}`;

        const cachedResults = cache.get(cacheKey);
        if (cachedResults) {
            logger.debug(`Returning cached results for search term: ${searchTerm}`);
            return res.json(cachedResults);
        }

        logger.debug(`Performing database search for term: ${searchTerm}`);
        const db = await database.getDb();
        const collection = db.collection(constants.COLLECTION_NAME);

        const query = { $text: { $search: searchTerm } };
        const projection = { score: { $meta: 'textScore' } };
        const sort = { score: { $meta: 'textScore' } };

        const eventsData = await collection.find(query).project(projection).sort(sort).toArray();

        // Use a shorter TTL for search results, e.g., 5 minutes (300 seconds)
        const searchCacheTtl = constants.CACHE_TTL_SEARCH || 300;
        cache.set(cacheKey, eventsData, searchCacheTtl);
        logger.debug(`Cached ${eventsData.length} results for search term: ${searchTerm}`);

        res.json(eventsData);
    } catch (error) {
        logger.error('Error searching events:', { message: error.message, query: req.query.q });
        res.status(500).json({
            error: 'An error occurred while searching events',
            details: error.message
        });
    }
});

module.exports = router;
