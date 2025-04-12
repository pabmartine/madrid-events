const express = require('express');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const winston = require('winston');
const xml2js = require('xml2js');
const fs = require('fs').promises;
const path = require('path');

const {
    Event,
    EventDomainService
} = require('./domain');
const constants = require('./config/constants');
const cors = require('./config/cors');
const limiter = require('./config/rateLimiter');
const logger = require('./config/logger');
const axios = require('./config/axios');
const cache = require('./service/cache');
const database = require('./service/database');
const errorHandler = require('./middleware/errorHandler');
const LocationQueue = require('./service/locationQueue');
const SubwayQueue = require('./service/subwayQueue');
const ImageQueue = require('./service/imageQueue');

// Importar utilidades
const StringUtils = require('./utils/stringUtils');
const EventUtils = require('./utils/eventUtils');
const SubwayUtils = require('./utils/subwayUtils');
const DatabaseUtils = require('./utils/databaseUtils');
const CoordinateUtils = require('./utils/coordinatesUtils');

const routes = require('./routes');

const app = express();

let baseLat = constants.BASE_LAT;
let baseLon = constants.BASE_LON;
let locationQueue;
let subwayQueue;
let imageQueue;
let updateIntervalId;
let fetchIntervalId;
let isEventsFetchInProgress = false;

// Inicialización de datos del metro
async function initializeSubwayData() {
    try {
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

async function scrapeImageFromUrl(url, eventId) {
    if (!imageQueue) {
        logger.error('Image queue service not initialized');
        return null;
    }
    return imageQueue.getImageUrl(eventId, url);
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



async function processEventCoordinates(event, locationDetails, nearestSubway) {
    try {
        const originalLat = event.latitude;
        const originalLon = event.longitude;

        logger.debug(`Processing coordinates for event ${event.id}`, {
            latitude: originalLat,
            longitude: originalLon
        });

        const [locationPromise, subwayPromise] = await Promise.all([
            (!locationDetails.distrito || !locationDetails.barrio || !locationDetails.direccion || !locationDetails.ciudad) ?
            getLocationDetails(originalLat, originalLon, event.id) :
            Promise.resolve(locationDetails),
            (!nearestSubway) ?
            getNearestSubway(originalLat, originalLon, event.id) :
            Promise.resolve(nearestSubway)
        ]);

        locationDetails = locationPromise;
        nearestSubway = subwayPromise;

        let subwayLines = [];
        if (nearestSubway) {
            logger.debug(`Found subway station for event ${event.id}: ${nearestSubway}`);
            subwayLines = await SubwayUtils.getSubwayLines(nearestSubway, cache.getSubwayData());
            logger.debug(`Retrieved subway lines for event ${event.id}`, {
                station: nearestSubway,
                lines: subwayLines
            });
        } else {
            logger.debug(`No nearby subway found for event ${event.id}`);
        }

        event.latitude = originalLat;
        event.longitude = originalLon;
        event.distance = EventDomainService.calculateDistance(event, baseLat, baseLon);
        logger.debug(`Calculated distance for event ${event.id}: ${event.distance}`);

        return {
            locationDetails,
            nearestSubway,
            subwayLines
        };
    } catch (error) {
        logger.error(`Error processing coordinates for event ${event.id}:`, {
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
            event.eventLocation = StringUtils.cleanOrganizationName(event.eventLocation, event.distrito, event.barrio);
            if (originalLocation !== event.eventLocation) {
                logger.debug(`Organization name cleaned for event ${event.id}`, {
                    original: originalLocation,
                    cleaned: event.eventLocation
                });
            }
        }

        if (event.organizationName) {
            event.organizationName = StringUtils.cleanOrganizationName(event.organizationName, event.distrito, event.barrio);
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

        if (!EventUtils.isEventWithinValidDateRange(event)) {
            logger.debug(`Skipping event ${event.id} - outside valid date range`, {
                title: event.title,
                startDate: event.dtstart,
                endDate: event.dtend
            });
            return;
        }

        logger.debug(`Processing event ${event.id}`, {
            title: event.title,
            isXml: fromXml
        });

        const {
            locationDetails,
            nearestSubway,
            imageUrl: existingImageUrl,
            subwayLines
        } = await DatabaseUtils.getExistingEventData(collection, event.id, constants);

        let processedData = {
            locationDetails,
            nearestSubway,
            subwayLines
        };

        if (EventDomainService.hasValidCoordinates(event)) {
            processedData = await processEventCoordinates(
                event,
                locationDetails,
                nearestSubway
            );
        } else {
            logger.debug(`Event ${event.id} has no valid coordinates to process`);
        }

        const imageUrl = existingImageUrl || await scrapeImageFromUrl(event.link, event.id);

        event = await updateEventWithData(
            event,
            processedData.locationDetails,
            processedData.nearestSubway,
            processedData.subwayLines,
            imageUrl
        );

        await collection.updateOne({
            id: event.id
        }, {
            $set: event.toJSON()
        }, {
            upsert: true
        });

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
            eventsData = StringUtils.stripInvalidControlCharacters(eventsData);
            try {
                eventsData = JSON.parse(eventsData);
            } catch (parseError) {
                logger.error('Error parsing JSON:', {
                    error: parseError.message,
                    data: eventsData.substring(Math.max(0, 1059022 - 50), 1059022 + 50) + '...' //Show the area around the error
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

async function fetchAllEvents() {
    if (isEventsFetchInProgress) {
        logger.info('Events fetch already in progress, skipping this cycle');
        return;
    }

    try {
        isEventsFetchInProgress = true;
        logger.info('Starting sequential events fetch process');

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

// Middleware setup
app.use(errorHandler);
app.use(cors);
app.use(helmet());
app.use(limiter);
app.use('/', routes);




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

    // Inicializar servicios de cola
    const db = await database.getDb();
    locationQueue = new LocationQueue(db);
    subwayQueue = new SubwayQueue(db);
    imageQueue = new ImageQueue(db);
    logger.info('Queue services initialized');

    await DatabaseUtils.deletePastEvents(db, constants.COLLECTION_NAME);
    await fetchAllEvents();

    updateIntervalId = setInterval(() => DatabaseUtils.deletePastEvents(db, constants.COLLECTION_NAME), constants.UPDATE_INTERVAL);
    fetchIntervalId = setInterval(fetchAllEvents, constants.UPDATE_INTERVAL);
});

async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Shutting down server...`);
    try {
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