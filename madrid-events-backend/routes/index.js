const express = require('express');
const router = express.Router();

const eventRoutes = require('./eventsRoute');
const imageRoutes = require('./imagesRoute');
const subwayRoutes = require('./subwaysRoute');
const coordinateRoutes = require('./coordinatesRoute');
const healthRoutes = require('./healthRoute');

router.use('/getEvents', eventRoutes);
router.use('/getImage', imageRoutes);
router.use('/getSubwayLines', subwayRoutes);
router.use('/recalculate', coordinateRoutes);
router.use('/healthz', healthRoutes);

module.exports = router;
