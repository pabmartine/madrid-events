const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const database = require('../service/database');
const cache = require('../service/cache');
const constants = require('../config/constants');
const ValidationUtils = require('../utils/validationUtils');

const EVENTS_CACHE_TTL_SECONDS = 60 * 60;

function normalizeDateValue(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    if (typeof value === 'string') {
        let sanitized = value.trim();
        if (!sanitized.includes('T')) {
            sanitized = sanitized.replace(' ', 'T');
        }
        const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(sanitized);
        if (!hasTimezone) {
            sanitized = sanitized.endsWith('Z') ? sanitized : `${sanitized}Z`;
        }
        const parsed = new Date(sanitized);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function eventMatchesDateFilters(event, startDate, endDate, includePastEvents) {
    const eventStart = normalizeDateValue(event.dtstart);
    const eventEnd = normalizeDateValue(event.dtend);

    if (startDate && (!eventStart || eventStart < startDate)) {
        return false;
    }
    if (endDate && (!eventStart || eventStart > endDate)) {
        return false;
    }
    if (!includePastEvents) {
        const now = new Date();
        if (!eventEnd || eventEnd < now) {
            return false;
        }
    }
    return true;
}

function buildEventsCacheKey(params) {
    return `events:${JSON.stringify(params)}`;
}

// Endpoint to get events with optional filters
router.get('/', async (req, res) => {
    try {
        const {
            distrito_nombre,
            barrio_nombre,
            startDate,
            endDate,
            free,
            children,
            limit,
            page,
            includePast
        } = req.query;

        const normalizedLimit = ValidationUtils.parseInteger(limit, {
            min: 1,
            max: constants.MAX_PAGE_SIZE,
            defaultValue: constants.DEFAULT_PAGE_SIZE
        });
        const normalizedPage = ValidationUtils.parseInteger(page, {
            min: 1,
            max: Number.MAX_SAFE_INTEGER,
            defaultValue: 1
        });
        const shouldPaginate = typeof limit !== 'undefined';
        const skip = shouldPaginate ? (normalizedPage - 1) * normalizedLimit : 0;

        const includePastEvents = ValidationUtils.parseBoolean(includePast, false);

        const cacheParams = {
            distrito_nombre,
            barrio_nombre,
            startDate,
            endDate,
            free: ValidationUtils.parseBoolean(free, false),
            children: ValidationUtils.parseBoolean(children, false),
            limit: shouldPaginate ? normalizedLimit : null,
            page: shouldPaginate ? normalizedPage : null,
            includePast: includePastEvents
        };

        const cacheKey = buildEventsCacheKey(cacheParams);
        const cachedEvents = cache.get(cacheKey);
        if (cachedEvents) {
            if (shouldPaginate && typeof cachedEvents.total === 'number') {
                res.setHeader('X-Total-Count', cachedEvents.total);
                return res.json(cachedEvents.items);
            }
            return res.json(cachedEvents);
        }

        const db = await database.getDb();
        const collection = db.collection(constants.COLLECTION_NAME);

        const query = {};
        if (distrito_nombre) query.distrito = distrito_nombre;
        if (barrio_nombre) query.barrio = barrio_nombre;

        const parsedStart = ValidationUtils.parseDate(startDate);
        const parsedEnd = ValidationUtils.parseDate(endDate);

        if (parsedStart && parsedEnd && parsedStart > parsedEnd) {
            return res.status(400).json({
                error: 'startDate must be earlier than endDate'
            });
        }

        if (ValidationUtils.parseBoolean(free, false)) {
            query.free = true;
        }

        if (ValidationUtils.parseBoolean(children, false)) {
            query.audience = { $in: ['children'] };
        }

        const cursor = collection.find(query).sort({ dtstart: 1 });
        let eventsData = await cursor.toArray();

        if (parsedStart || parsedEnd || !includePastEvents) {
            eventsData = eventsData.filter(event =>
                eventMatchesDateFilters(event, parsedStart, parsedEnd, includePastEvents)
            );
        }

        const totalCount = eventsData.length;

        if (shouldPaginate) {
            const paginated = eventsData.slice(skip, skip + normalizedLimit);
            cache.set(cacheKey, { items: paginated, total: totalCount }, EVENTS_CACHE_TTL_SECONDS);
            res.setHeader('X-Total-Count', totalCount);
            return res.json(paginated);
        }

        cache.set(cacheKey, eventsData, EVENTS_CACHE_TTL_SECONDS);
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
