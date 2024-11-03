const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const cache = require('../service/cache');
const SubwayUtils = require('../utils/subwayUtils');

router.get('/', async (req, res) => {
    const { subway } = req.query;

    if (!subway) {
        return res.status(400).json({
            error: 'Missing subway parameter'
        });
    }

    try {
        const cachedLines = await cache.getSubwayLines(subway);
        if (cachedLines) {
            return res.json(cachedLines);
        }

        const subwayData = cache.getSubwayData();
        const lines = await SubwayUtils.getSubwayLines(subway, subwayData);

        if (lines.length > 0) {
            const response = {
                subway: subway,
                lines: lines
            };

            cache.setSubwayLines(subway, response);
            res.json(response);
        } else {
            res.status(404).json({
                error: 'Subway station not found'
            });
        }
    } catch (error) {
        logger.error('Error fetching subway lines:', error.message);
        res.status(500).json({
            error: 'An error occurred while fetching subway lines',
            details: error.message
        });
    }
});

module.exports = router;