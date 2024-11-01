
const express = require('express');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const winston = require('winston');
const xml2js = require('xml2js');
const fs = require('fs').promises;

const { Event, EventDomainService } = require('./domain');
const constants = require('./config/constants');
const cors = require('./config/cors');
const limiter = require('./config/rateLimiter');
const logger = require('./utils/logger');
const axios = require('./utils/axios');
const cache = require('./service/cache');
const database = require('./service/database');
const errorHandler = require('./middleware/errorHandler');

const app = express();

let baseLat = constants.BASE_LAT;
let baseLon = constants.BASE_LON;

// Inicialización de datos del metro
async function initializeSubwayData() {
    try {
        // Primero verificamos si ya están en caché
        let subwayData = cache.getSubwayData();
        if (subwayData) {
            logger.info('Subway data loaded from cache', {
                stationsCount: subwayData.length
            });
            return true;
        }

        const filePath = path.join(__dirname, 'assets', 'madrid-events.subways.json');
        logger.info('Loading subway data from JSON file', {
            filePath
        });

        const jsonContent = await fs.readFile(filePath, 'utf8');
        subwayData = JSON.parse(jsonContent);

        // Guardamos en caché
        cache.setSubwayData(subwayData);

        logger.info('Subway data loaded and cached successfully', {
            stationsCount: subwayData.length
        });

        return true;
    } catch (error) {
        logger.error('Error loading subway data:', {
            error: error.message,
            stack: error.stack
        });
        return false;
    }
}

// Función para obtener las líneas de una estación
async function getSubwayLines(stationName) {
    try {
        const subwayData = cache.getSubwayData();
        if (!subwayData) {
            logger.error('Subway data not initialized');
            return [];
        }

        const normalizedStationName = normalizeString(stationName);

        logger.debug('Searching for subway lines', {
            station: stationName,
            normalizedName: normalizedStationName
        });

        const stationData = subwayData.find(station =>
            normalizeString(station.subway) === normalizedStationName
        );

        if (stationData) {
            logger.debug('Found subway lines', {
                station: stationName,
                lines: stationData.lines
            });
            return stationData.lines;
        }

        logger.debug('No subway lines found for station', {
            station: stationName
        });
        return [];
    } catch (error) {
        logger.error('Error getting subway lines:', {
            error: error.message,
            station: stationName
        });
        return [];
    }
}

function stripInvalidControlCharacters(str) {
    return str.replace(/[\x00-\x1F\x7F]/g, '');
}

function cleanOrganizationName(orgName, distrito, barrio) {
    const regex = /\(([^)]+)\)/g;
    return orgName.replace(regex, (match, p1) => {
        const normalizedP1 = p1.trim().toLowerCase();
        if (normalizedP1 === distrito.toLowerCase() || normalizedP1 === barrio.toLowerCase()) {
            return '';
        }
        return match;
    }).trim();
}

async function scrapeImageFromUrl(url) {
    try {
        logger.debug('Starting image scraping', {
            url
        });

        const response = await axios.get(url);
        logger.debug('Received response from URL', {
            url,
            status: response.status,
            contentType: response.headers['content-type'],
            dataLength: response.data.length
        });

        const $ = cheerio.load(response.data);
        const imageElement = $('.image-content img');

        if (!imageElement.length) {
            logger.warn('No image element found with selector .image-content img', {
                url,
                htmlSample: response.data.substring(0, 200) + '...'
            });
        }

        let imageUrl = imageElement.attr('src');

        if (imageUrl && !imageUrl.startsWith('http')) {
            const originalImageUrl = imageUrl;
            imageUrl = `https://www.madrid.es${imageUrl}`;
        }

        const finalImageUrl = imageUrl || constants.IMAGE_NOT_FOUND;
        logger.debug('Returning image URL', {
            originalUrl: url,
            finalImageUrl,
            isDefaultImage: finalImageUrl === constants.IMAGE_NOT_FOUND
        });

        return finalImageUrl;
    } catch (error) {
        logger.error('Error scraping image', {
            url,
            error: error.message,
            stack: error.stack,
            response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                headers: error.response.headers,
                data: error.response.data ? error.response.data.substring(0, 200) + '...' : 'No response data'
            } : 'No response object'
        });

        if (error.code) {
            logger.error('Network or system error details', {
                code: error.code,
                syscall: error.syscall,
                hostname: error.hostname,
                port: error.port
            });
        }

        return null;
    }
}

function validateCoordinates(req, res, next) {
    const {
        lat,
        lon
    } = req.query;
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({
            error: 'Invalid latitude or longitude'
        });
    }
    next();
}

async function getLocationDetails(latitude, longitude) {
    let attempts = 0;
    while (attempts < constants.MAX_RETRIES) {
        try {
            const response = await axios.get(`${constants.NOMINATIM_API_BASE}?lat=${latitude}&lon=${longitude}&format=json`);
            const {
                address
            } = response.data;

            logger.debug(`Successfully fetched location details on attempt ${attempts + 1}`, {
                latitude,
                longitude
            });

            return {
                distrito: address.quarter || '',
                barrio: address.suburb || '',
                direccion: address.road || '',
                ciudad: address.city || ''
            };
        } catch (error) {
            attempts++;
            const delay = constants.RETRY_DELAY * Math.pow(2, attempts - 1);

            if (attempts >= constants.MAX_RETRIES) {
                logger.error('Max retries reached for location details. Returning empty values.', {
                    latitude,
                    longitude,
                    totalAttempts: attempts
                });
                return {
                    distrito: '',
                    barrio: '',
                    direccion: '',
                    ciudad: ''
                };
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function getNearestSubway(lat, lon) {
    const overpassUrl = `${constants.OVERPASS_API_BASE}?data=[out:json];node(around:1000,${lat},${lon})[railway=station][operator="Metro de Madrid"];out;`;
    let attempts = 0;
    while (attempts < constants.MAX_RETRIES) {
        try {
            const response = await axios.get(overpassUrl);
            const elements = response.data.elements;

            logger.debug(`Successfully fetched subway data on attempt ${attempts + 1}`, {
                latitude: lat,
                longitude: lon
            });

            if (elements && elements.length > 0) {
                const station = elements.find(element => element.tags && element.tags.name);
                return station ? station.tags.name : null;
            } else {
                return null;
            }
        } catch (error) {
            attempts++;
            const delay = constants.RETRY_DELAY * Math.pow(2, attempts - 1);

            if (attempts >= constants.MAX_RETRIES) {
                logger.error('Max retries reached for subway data. Returning null.', {
                    latitude: lat,
                    longitude: lon,
                    totalAttempts: attempts
                });
                return null;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return null;
}

async function deletePastEvents() {
    try {
        const db = await database.getDb();
        const collection = db.collection(constants.COLLECTION_NAME);
        const currentDate = new Date().toISOString();

        const result = await collection.deleteMany({
            dtend: {
                $lt: currentDate
            }
        });

        logger.info(`Deleted past events`, {
            count: result.deletedCount
        });
    } catch (error) {
        logger.error('Error deleting past events:', error.message);
    }
}

// Agregamos un semáforo para controlar la ejecución
let isEventsFetchInProgress = false;

async function fetchAllEvents() {
    if (isEventsFetchInProgress) {
        logger.info('Events fetch already in progress, skipping this cycle');
        return;
    }

    try {
        isEventsFetchInProgress = true;
        logger.info('Starting sequential events fetch process');

        try {
            await fetchAndStoreEvents();
            logger.info('JSON events fetch completed successfully');
        } catch (jsonError) {
            logger.error('JSON events fetch failed, continuing with XML fetch:', {
                error: jsonError.message,
                stack: jsonError.stack
            });
        }

        try {
            await fetchAndStoreXmlEvents();
            logger.info('XML events fetch completed successfully');
        } catch (xmlError) {
            logger.error('XML events fetch failed:', {
                error: xmlError.message,
                stack: xmlError.stack
            });
        }

        cache.clearPattern('events:');
        logger.info('Cache cleared after both fetches completed');

    } catch (error) {
        logger.error('Critical error in fetchAllEvents:', {
            error: error.message,
            stack: error.stack
        });
    } finally {
        isEventsFetchInProgress = false;
    }
}

async function fetchAndStoreEvents() {
    logger.info('Starting JSON events fetch and store process');
    try {
        logger.info(`Fetching events from API: ${constants.EVENTS_API_URL}`);
        const response = await axios.get(constants.EVENTS_API_URL);

        if (!response || !response.data) {
            throw new Error('No data received from API');
        }

        let eventsData = response.data;
        logger.info(`Received response with length: ${JSON.stringify(eventsData).length}`);

        if (typeof eventsData === 'string') {
            logger.info('Response is string, attempting to clean and parse');
            eventsData = stripInvalidControlCharacters(eventsData);
            try {
                eventsData = JSON.parse(eventsData);
            } catch (parseError) {
                logger.error('Error parsing JSON:', {
                    error: parseError.message,
                    data: eventsData.substring(0, 200) + '...'
                });
                throw parseError;
            }
        }

        if (!eventsData || !eventsData['@graph']) {
            logger.error('Invalid data structure received:', {
                keys: Object.keys(eventsData || {}),
                dataType: typeof eventsData,
                sample: JSON.stringify(eventsData).substring(0, 200) + '...'
            });
            throw new Error('Unexpected API response structure: missing @graph');
        }

        logger.info(`Processing ${eventsData['@graph'].length} events`);

        const db = await database.getDb();
        const collection = db.collection(constants.COLLECTION_NAME);

        const eventPromises = eventsData['@graph'].map(async (eventData, index) => {
            try {
                let locationDetails = {
                    distrito: '',
                    barrio: '',
                    direccion: '',
                    ciudad: ''
                };
                let nearestSubway = null;
                let imageUrl = null;
                let subwayLines = [];

                if (index % 10 === 0) {
                    logger.debug(`Processing event ${index + 1}/${eventsData['@graph'].length}`);
                }

                const existingEvent = await collection.findOne({
                    id: eventData.id
                });
                let event;

                if (existingEvent) {
                    event = EventDomainService.fromJSON(existingEvent);
                    locationDetails = {
                        distrito: event.distrito || '',
                        barrio: event.barrio || '',
                        direccion: event.streetAddress || '',
                        ciudad: event.locality || ''
                    };
                    nearestSubway = event.subway || null;
                    imageUrl = event.image || null;
                    subwayLines = event.subwayLines || [];
                } else {
                    event = EventDomainService.fromJSON(eventData);
                }

                if (EventDomainService.hasValidCoordinates(event)) {
                    // Guardamos las coordenadas originales
                    const originalLat = event.latitude;
                    const originalLon = event.longitude;

                    logger.debug(`Processing coordinates for event ${event.id}`, {
                        latitude: originalLat,
                        longitude: originalLon
                    });

                    if (!locationDetails.distrito || !locationDetails.barrio || !locationDetails.direccion || !locationDetails.ciudad) {
                        try {
                            locationDetails = await getLocationDetails(originalLat, originalLon);
                            logger.debug(`Location details retrieved for event ${event.id}`, locationDetails);
                        } catch (error) {
                            logger.error(`Failed to get location details for event ${event.id}`, {
                                latitude: originalLat,
                                longitude: originalLon,
                                error: error.message
                            });
                            // Mantenemos locationDetails con valores vacíos
                        }
                    }

                    // Aseguramos que las coordenadas originales se mantengan
                    event.latitude = originalLat;
                    event.longitude = originalLon;
                    event.distance = EventDomainService.calculateDistance(event, baseLat, baseLon);

                    if (!nearestSubway) {
                        try {
                            nearestSubway = await getNearestSubway(originalLat, originalLon);
                            if (nearestSubway) {
                                logger.debug(`Found subway station for event ${event.id}: ${nearestSubway}`);
                                subwayLines = await getSubwayLines(nearestSubway);
                            }
                        } catch (error) {
                            logger.error(`Failed to get subway info for event ${event.id}`, {
                                latitude: originalLat,
                                longitude: originalLon,
                                error: error.message
                            });
                            // No afectamos las coordenadas aunque falle la búsqueda de metro
                        }
                    }
                }

                if (!imageUrl) {
                    imageUrl = await scrapeImageFromUrl(event.link);
                }

                // Actualización de datos del evento
                event.distrito = locationDetails.distrito;
                event.barrio = locationDetails.barrio;
                event.streetAddress = locationDetails.direccion;
                event.locality = locationDetails.ciudad;
                event.subway = nearestSubway || '';
                event.subwayLines = subwayLines;
                event.image = imageUrl;

                if (event.eventLocation) {
                    event.eventLocation = cleanOrganizationName(event.eventLocation, event.distrito, event.barrio);
                }
                if (event.organizationName) {
                    event.organizationName = cleanOrganizationName(event.organizationName, event.distrito, event.barrio);
                }

                await collection.updateOne({
                    id: event.id
                }, {
                    $set: event.toJSON()
                }, {
                    upsert: true
                });

            } catch (eventError) {
                logger.error(`Error processing event at index ${index}:`, {
                    error: eventError.message,
                    stack: eventError.stack,
                    eventData: JSON.stringify(eventData).substring(0, 200) + '...'
                });
                throw eventError;
            }
        });

        logger.info('Waiting for all event promises to resolve');
        await Promise.all(eventPromises);
        logger.info('All events processed successfully');

    } catch (error) {
        logger.error('Error in fetchAndStoreEvents:', {
            error: error.message,
            stack: error.stack,
            type: error.name,
            code: error.code,
            response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: JSON.stringify(error.response.data).substring(0, 200) + '...'
            } : 'No response data'
        });
        throw error;
    }
}

async function fetchAndStoreXmlEvents() {
    logger.info('Starting XML events fetch and store process');
    try {
        logger.info(`Fetching XML events from API: ${constants.XML_EVENTS_API_URL}`);
        const response = await axios.get(constants.XML_EVENTS_API_URL);

        if (!response || !response.data) {
            throw new Error('No XML data received from API');
        }

        const xmlData = response.data;
        logger.info(`Received XML response with length: ${xmlData.length}`);

        logger.info('Attempting to parse XML data');
        const parser = new xml2js.Parser();
        let result;
        try {
            result = await parser.parseStringPromise(xmlData);
            logger.info('XML successfully parsed');
        } catch (parseError) {
            logger.error('Error parsing XML:', {
                error: parseError.message,
                stack: parseError.stack,
                xmlSample: xmlData.substring(0, 200) + '...'
            });
            throw parseError;
        }

        if (!result || !result.serviceList || !result.serviceList.service) {
            logger.error('Invalid XML structure received:', {
                resultKeys: result ? Object.keys(result) : 'null',
                hasServiceList: result ? !!result.serviceList : false,
                hasService: result?.serviceList ? !!result.serviceList.service : false,
                sample: JSON.stringify(result).substring(0, 200) + '...'
            });
            throw new Error('Unexpected XML structure');
        }

        const totalEvents = result.serviceList.service.length;
        logger.info(`Found ${totalEvents} XML events to process`);

        const db = await database.getDb();
        const collection = db.collection(constants.COLLECTION_NAME);

        const eventPromises = result.serviceList.service.map(async (xmlEvent, index) => {
            try {
                if (index % 10 === 0) {
                    logger.debug(`Processing XML event ${index + 1}/${totalEvents}`);
                }

                const event = EventDomainService.fromXMLData(xmlEvent);

                if (!event) {
                    logger.warn(`Failed to create event from XML data at index ${index}`);
                    return;
                }

                if (!EventDomainService.isActive(event)) {
                    logger.debug(`Skipping inactive event ${event.id} at index ${index}`);
                    return;
                }

                logger.debug(`Starting processing of XML event ${event.id}`, {
                    index,
                    title: event.title
                });

                let locationDetails = {
                    distrito: '',
                    barrio: '',
                    direccion: '',
                    ciudad: ''
                };
                let nearestSubway = null;
                let subwayLines = [];

                const existingEvent = await collection.findOne({
                    id: event.id
                });

                if (existingEvent) {
                    logger.debug(`Using existing data for event ${event.id}`);
                    const existingEventObj = EventDomainService.fromJSON(existingEvent);
                    locationDetails = {
                        distrito: existingEventObj.distrito || '',
                        barrio: existingEventObj.barrio || '',
                        direccion: existingEventObj.streetAddress || '',
                        ciudad: existingEventObj.locality || ''
                    };
                    nearestSubway = existingEventObj.subway || null;
                    subwayLines = existingEventObj.subwayLines || [];
                }

                if (EventDomainService.hasValidCoordinates(event)) {
                    // Guardamos las coordenadas originales
                    const originalLat = event.latitude;
                    const originalLon = event.longitude;

                    logger.debug(`Processing coordinates for event ${event.id}`, {
                        latitude: originalLat,
                        longitude: originalLon
                    });

                    if (!locationDetails.distrito || !locationDetails.barrio || !locationDetails.direccion || !locationDetails.ciudad) {
                        try {
                            logger.debug(`Fetching location details for event ${event.id}`);
                            locationDetails = await getLocationDetails(originalLat, originalLon);
                            logger.debug(`Location details retrieved for event ${event.id}`, locationDetails);
                        } catch (error) {
                            logger.error(`Failed to get location details for event ${event.id}`, {
                                latitude: originalLat,
                                longitude: originalLon,
                                error: error.message
                            });
                            // Mantenemos locationDetails con valores vacíos
                        }
                    }

                    // Aseguramos que las coordenadas originales se mantengan
                    event.latitude = originalLat;
                    event.longitude = originalLon;
                    event.distance = EventDomainService.calculateDistance(event, baseLat, baseLon);
                    logger.debug(`Calculated distance for event ${event.id}: ${event.distance}`);

                    if (!nearestSubway) {
                        try {
                            logger.debug(`Searching for nearest subway for event ${event.id}`);
                            nearestSubway = await getNearestSubway(originalLat, originalLon);

                            if (nearestSubway) {
                                logger.debug(`Found subway station for event ${event.id}: ${nearestSubway}`);
                                subwayLines = await getSubwayLines(nearestSubway);
                                logger.debug(`Retrieved subway lines for event ${event.id}`, {
                                    station: nearestSubway,
                                    lines: subwayLines
                                });
                            } else {
                                logger.debug(`No nearby subway found for event ${event.id}`);
                            }
                        } catch (error) {
                            logger.error(`Failed to get subway info for event ${event.id}`, {
                                latitude: originalLat,
                                longitude: originalLon,
                                error: error.message
                            });
                            // No afectamos las coordenadas aunque falle la búsqueda de metro
                        }
                    }
                } else {
                    logger.debug(`Event ${event.id} has no valid coordinates to process`);
                }

                logger.debug(`Updating event ${event.id} with collected data`, {
                    distrito: locationDetails.distrito,
                    barrio: locationDetails.barrio,
                    hasSubway: !!nearestSubway,
                    subwayLinesCount: subwayLines.length,
                    hasCoordinates: !!event.latitude && !!event.longitude
                });

                event.distrito = locationDetails.distrito;
                event.barrio = locationDetails.barrio;
                event.streetAddress = locationDetails.direccion;
                event.locality = locationDetails.ciudad;
                event.subway = nearestSubway || '';
                event.subwayLines = subwayLines;

                if (event.eventLocation) {
                    logger.debug(`Cleaning organization name for event ${event.id}`);
                    const originalLocation = event.eventLocation;
                    event.eventLocation = cleanOrganizationName(event.eventLocation, event.distrito, event.barrio);
                    if (originalLocation !== event.eventLocation) {
                        logger.debug(`Organization name cleaned for event ${event.id}`, {
                            original: originalLocation,
                            cleaned: event.eventLocation
                        });
                    }
                }

                logger.debug(`Attempting database update for event ${event.id}`);
                await collection.updateOne({
                    id: event.id
                }, {
                    $set: event.toJSON()
                }, {
                    upsert: true
                });

                logger.debug(`Successfully processed and stored event ${event.id}`);

            } catch (eventError) {
                logger.error(`Error processing XML event ${event?.id || 'unknown'} at index ${index}:`, {
                    error: eventError.message,
                    stack: eventError.stack,
                    eventData: JSON.stringify(xmlEvent).substring(0, 200) + '...'
                });
                throw eventError;
            }
        });

        logger.info('Waiting for all XML event promises to resolve');
        await Promise.all(eventPromises.filter(p => p !== undefined));
        logger.info('All XML events processed successfully');

    } catch (error) {
        logger.error('Error in fetchAndStoreXmlEvents:', {
            error: error.message,
            stack: error.stack,
            type: error.name,
            code: error.code,
            response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data ? error.response.data.substring(0, 200) + '...' : 'No response data'
            } : 'No response object'
        });
        throw error;
    }
}

app.use(errorHandler);
app.use(cors);
app.use(helmet());
app.use(limiter);

app.get('/recalculate', validateCoordinates, async (req, res) => {
    try {
        const {
            lat,
            lon
        } = req.query;

        logger.info('Recalculate coordinates request', {
            lat,
            lon
        });

        const newLat = parseFloat(lat).toFixed(2);
        const newLon = parseFloat(lon).toFixed(2);

        if (newLat !== baseLat.toFixed(2) || newLon !== baseLon.toFixed(2)) {
            baseLat = lat;
            baseLon = lon;

            logger.info('Recalculating distances with new coordinates', {
                baseLat,
                baseLon
            });
            await fetchAndStoreEvents();

            cache.clearPattern('events:');

            res.json({
                message: 'Recalculation completed with new coordinates',
                baseLat,
                baseLon
            });
        } else {
            res.status(400).json({
                message: 'Coordinates are the same, no recalculation needed',
                baseLat,
                baseLon
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

app.get('/getEvents', async (req, res) => {
    try {
        const {
            distrito_nombre,
            barrio_nombre
        } = req.query;

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

app.get('/getImage', async (req, res) => {
    try {
        const {
            id
        } = req.query;
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
        let eventData = await collection.findOne({
            id: id
        });

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

        const imageUrl = await scrapeImageFromUrl(event.link);

        if (imageUrl) {
            event.image = imageUrl;
            await collection.updateOne({
                id: id
            }, {
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

function normalizeString(str) {
    return str.toLowerCase();
}

app.get('/getSubwayLines', async (req, res) => {
    const {
        subway
    } = req.query;

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

        const lines = await getSubwayLines(subway);

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



app.listen(constants.PORT, async () => {
    logger.info(`Server starting`, {
        port: constants.PORT
    });

    // Inicializar conexión a la base de datos
    await database.connectToMongoDB();

    // Inicializar datos del metro
    const subwayInitialized = await initializeSubwayData();
    if (!subwayInitialized) {
        logger.error('Failed to initialize subway data, server might not work correctly');
    }

    await deletePastEvents();
    await fetchAllEvents();

    setInterval(deletePastEvents, constants.UPDATE_INTERVAL);
    setInterval(fetchAllEvents, constants.UPDATE_INTERVAL);
});

// Manejo de señales de terminación
process.on('SIGINT', async () => {
    logger.info('Shutting down server');
    try {
        await database.closeConnection();
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
    }
});

module.exports = app;