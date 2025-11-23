const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const database = require('../service/database');
const cache = require('../service/cache');
const constants = require('../config/constants');
const { EventDomainService } = require('../domain');

router.get('/', async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) {
            return res.status(400).json({
                error: 'Missing id parameter'
            });
        }

        const cachedImage = await cache.getImage(id);
        if (cachedImage) {
            return res.json({
                id,
                image: cachedImage
            });
        }

        const db = await database.getDb();
        const collection = db.collection(constants.COLLECTION_NAME);
        let eventData = await collection.findOne({ id: id });

        if (!eventData) {
            return res.status(404).json({
                error: 'Event not found'
            });
        }

        const event = EventDomainService.fromJSON(eventData);

        if (event.image) {
            cache.setImage(id, event.image);
            return res.json({
                id,
                image: event.image
            });
        }

        if (typeof global.scrapeImageFromUrl !== 'function') {
            logger.error('Image scraping service is not initialized');
            return res.status(503).json({
                error: 'Image service unavailable'
            });
        }

        const imageUrl = await global.scrapeImageFromUrl(event.link, event.id);

        if (imageUrl) {
            event.image = imageUrl;
            await collection.updateOne({ id: id }, {
                $set: event.toJSON()
            });
            cache.setImage(id, imageUrl);
        }

        res.json({
            id,
            image: imageUrl
        });

    } catch (error) {
        logger.error('Error fetching image:', error.message);
        res.status(500).json({
            error: 'An error occurred while fetching image',
            details: error.message
        });
    }
});

module.exports = router;
