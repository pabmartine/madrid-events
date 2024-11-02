
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
const LocationQueue = require('./service/locationQueue');
const SubwayQueue = require('./service/subwayQueue');
const ImageQueue = require('./service/imageQueue');

const app = express();

let baseLat = constants.BASE_LAT;
let baseLon = constants.BASE_LON;
let locationQueue;
let subwayQueue;
let imageQueue;

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

async function scrapeImageFromUrl(url, eventId) {
    if (!imageQueue) {
        logger.error('Image queue service not initialized');
        return null;
    }
    return imageQueue.getImageUrl(eventId, url);
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

async function getLocationDetails(latitude, longitude, eventId) {
    if (!locationQueue) {
        logger.error('Location queue service not initialized');
        return {
            distrito: '',
            barrio: '',
            direccion: '',
            ciudad: ''
        };
    }
    return locationQueue.getLocationDetails(latitude, longitude, eventId);
}

async function getNearestSubway(lat, lon, eventId) {
    if (!subwayQueue) {
        logger.error('Subway queue service not initialized');
        return null;
    }
    return subwayQueue.getNearestSubway(lat, lon, eventId);
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

         // Añadir un timeout de seguridad
                const fetchTimeout = setTimeout(() => {
                    logger.error('Events fetch timeout reached');
                    isEventsFetchInProgress = false;
                }, 30 * 60 * 1000); // 30 minutos

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

        clearTimeout(fetchTimeout);

    } catch (error) {
        logger.error('Critical error in fetchAllEvents:', {
            error: error.message,
            stack: error.stack
        });
    } finally {
        isEventsFetchInProgress = false;
    }
}

async function processEventCoordinates(event, locationDetails, nearestSubway) {
    try {
        const originalLat = event.latitude;
        const originalLon = event.longitude;

        logger.debug(`Processing coordinates for event ${event.id}`, {
            latitude: originalLat,
            longitude: originalLon
        });

        // Hacemos las dos peticiones en paralelo
        const [locationPromise, subwayPromise] = await Promise.all([
            // Petición de location si es necesaria
            (!locationDetails.distrito || !locationDetails.barrio || !locationDetails.direccion || !locationDetails.ciudad)
                ? getLocationDetails(originalLat, originalLon, event.id)
                : Promise.resolve(locationDetails),

            // Petición de subway si es necesaria
            (!nearestSubway)
                ? getNearestSubway(originalLat, originalLon, event.id)
                : Promise.resolve(nearestSubway)
        ]);

        // Actualizamos los resultados
        locationDetails = locationPromise;
        nearestSubway = subwayPromise;

        // Si encontramos subway, obtenemos las líneas
        let subwayLines = [];
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

        // Aseguramos que las coordenadas originales se mantengan
        event.latitude = originalLat;
        event.longitude = originalLon;
        event.distance = EventDomainService.calculateDistance(event, baseLat, baseLon);
        logger.debug(`Calculated distance for event ${event.id}: ${event.distance}`);

        return { locationDetails, nearestSubway, subwayLines };
    } catch (error) {
        logger.error(`Error processing coordinates for event ${event.id}:`, {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function getExistingEventData(collection, eventId) {
    try {
        const existingEvent = await collection.findOne({ id: eventId });

        if (!existingEvent) {
            logger.debug(`No existing data found for event ${eventId}`);
            return {
                locationDetails: {
                    distrito: '',
                    barrio: '',
                    direccion: '',
                    ciudad: ''
                },
                nearestSubway: null,
                imageUrl: null,
                subwayLines: []
            };
        }

        logger.debug(`Found existing data for event ${eventId}`);
        const event = EventDomainService.fromJSON(existingEvent);
        return {
            locationDetails: {
                distrito: event.distrito || '',
                barrio: event.barrio || '',
                direccion: event.streetAddress || '',
                ciudad: event.locality || ''
            },
            nearestSubway: event.subway || null,
            imageUrl: event.image || null,
            subwayLines: event.subwayLines || []
        };
    } catch (error) {
        logger.error(`Error getting existing data for event ${eventId}:`, {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function updateEventWithData(event, locationDetails, nearestSubway, subwayLines, imageUrl) {
    try {
        logger.debug(`Updating event ${event.id} with collected data`, {
            distrito: locationDetails.distrito,
            barrio: locationDetails.barrio,
            hasSubway: !!nearestSubway,
            subwayLinesCount: subwayLines.length,
            hasImage: !!imageUrl,
            hasCoordinates: !!event.latitude && !!event.longitude
        });

        event.distrito = locationDetails.distrito;
        event.barrio = locationDetails.barrio;
        event.streetAddress = locationDetails.direccion;
        event.locality = locationDetails.ciudad;
        event.subway = nearestSubway || '';
        event.subwayLines = subwayLines;
        event.image = imageUrl;

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

        if (event.organizationName) {
            event.organizationName = cleanOrganizationName(event.organizationName, event.distrito, event.barrio);
        }

        return event;
    } catch (error) {
        logger.error(`Error updating event ${event.id}:`, {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

async function processAndStoreEvent(collection, eventData, fromXml = false) {
    try {
        let event;
        if (fromXml) {
            event = EventDomainService.fromXMLData(eventData);
            if (!event) {
                logger.warn(`Failed to create event from XML data`);
                return;
            }
            if (!EventDomainService.isActive(event)) {
                logger.debug(`Skipping inactive event ${event.id}`);
                return;
            }
        } else {
            event = EventDomainService.fromJSON(eventData);
        }

        logger.debug(`Processing event ${event.id}`, {
            title: event.title,
            isXml: fromXml
        });

        // Obtener datos existentes
        const {
            locationDetails,
            nearestSubway,
            imageUrl: existingImageUrl,
            subwayLines
        } = await getExistingEventData(collection, event.id);

        let processedData = {
            locationDetails,
            nearestSubway,
            subwayLines
        };

        // Procesar coordenadas si son válidas
        if (EventDomainService.hasValidCoordinates(event)) {
            processedData = await processEventCoordinates(
                event,
                locationDetails,
                nearestSubway
            );
        } else {
            logger.debug(`Event ${event.id} has no valid coordinates to process`);
        }

        // Obtener imagen si es necesario
        const imageUrl = existingImageUrl || await scrapeImageFromUrl(event.link, event.id);

        // Actualizar evento con todos los datos
        event = await updateEventWithData(
            event,
            processedData.locationDetails,
            processedData.nearestSubway,
            processedData.subwayLines,
            imageUrl
        );

        // Guardar en base de datos
        await collection.updateOne(
            { id: event.id },
            { $set: event.toJSON() },
            { upsert: true }
        );

        logger.debug(`Successfully processed and stored event ${event.id}`);

    } catch (error) {
        logger.error(`Error processing event:`, {
            error: error.message,
            stack: error.stack,
            eventId: eventData.id || 'unknown',
            isXml: fromXml
        });
        throw error;
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
                if (index % 10 === 0) {
                    logger.debug(`Processing event ${index + 1}/${eventsData['@graph'].length}`);
                }
                await processAndStoreEvent(collection, eventData, false);
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

                await processAndStoreEvent(collection, xmlEvent, true);
            } catch (eventError) {
                logger.error(`Error processing XML event at index ${index}:`, {
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

            imageUrl = await scrapeImageFromUrl(event.link, event.id);


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

let updateIntervalId;
let fetchIntervalId;

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

     // Inicializar la cola de ubicaciones
      const db = await database.getDb();
      locationQueue = new LocationQueue(db);
      subwayQueue = new SubwayQueue(db);
      imageQueue = new ImageQueue(db);
      logger.info('Queue services initialized');

    await deletePastEvents();
    await fetchAllEvents();

    updateIntervalId = setInterval(deletePastEvents, constants.UPDATE_INTERVAL);
    fetchIntervalId = setInterval(fetchAllEvents, constants.UPDATE_INTERVAL);
});

async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Shutting down server...`);
    try {
        // Limpiamos las colas y paramos sus workers
        if (locationQueue) {
            locationQueue.clearQueue();
            locationQueue.stopProcessing();
        }
        if (subwayQueue) {
            subwayQueue.clearQueue();
            subwayQueue.stopProcessing();
        }

        if (imageQueue) {
            imageQueue.clearQueue();
            imageQueue.stopProcessing();
        }

        clearInterval(updateIntervalId);
        clearInterval(fetchIntervalId);

        // Cerramos la conexión a la base de datos
        await database.closeConnection();

        logger.info('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;