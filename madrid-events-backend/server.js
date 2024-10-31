const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const { MongoClient } = require('mongodb');
const rateLimit = require("express-rate-limit");
const helmet = require('helmet');
const winston = require('winston');
const xml2js = require('xml2js');
const constants = require('./config/constants');
const { Event, EventDomainService } = require('./domain');

const app = express();

let db;
let baseLat = constants.BASE_LAT;
let baseLon = constants.BASE_LON;

// Configuración de CORS - debe ir antes de las rutas
app.use(cors({
    origin: function (origin, callback) {
        // Permitir peticiones sin origin (como las de Postman)
        if (!origin) {
            return callback(null, true);
        }

        const allowedOrigins = constants.FRONTEND_URL.split(',').map(url => url.trim());

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('Origin blocked by CORS:', origin);
            console.log('Allowed origins:', allowedOrigins);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true, // Permitir credenciales
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Crear un logger personalizado usando Winston
const logger = winston.createLogger({
    level: 'error',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            level: 'error',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({ filename: 'error.log', level: 'error' })
    ]
});

// Configuración de Axios
axios.defaults.timeout = constants.AXIOS_TIMEOUT;

axios.interceptors.response.use(null, (error) => {
    if (error.config && error.response && error.response.status >= 500) {
        return axios.request(error.config);
    }
    return Promise.reject(error);
});

// Caché en memoria
const subwayCache = {};
const imageCache = {};

// Aplicar helmet para seguridad
app.use(helmet());

// Aplicar rate limiting
const limiter = rateLimit({
    windowMs: constants.RATE_LIMIT_WINDOW_MS,
    max: constants.RATE_LIMIT_MAX_REQUESTS
});
app.use(limiter);

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
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const imageElement = $('.image-content img');
        let imageUrl = imageElement.attr('src');

        if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = `https://www.madrid.es${imageUrl}`;
        }
        return imageUrl || constants.IMAGE_NOT_FOUND;
    } catch (error) {
        logger.error('Error scraping the image:', error.message);
        return null;
    }
}

function validateCoordinates(req, res, next) {
    const { lat, lon } = req.query;
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: 'Invalid latitude or longitude' });
    }
    next();
}

async function getLocationDetails(latitude, longitude) {
    let attempts = 0;
    while (attempts < constants.MAX_RETRIES) {
        try {
            const response = await axios.get(`${constants.NOMINATIM_API_BASE}?lat=${latitude}&lon=${longitude}&format=json`);
            const { address } = response.data;
            return {
                distrito: address.quarter || '',
                barrio: address.suburb || '',
                direccion: address.road || '',
                ciudad: address.city || ''
            };
        } catch (error) {
            attempts++;
            logger.error(`Attempt ${attempts} failed: ${error.message}`);
            if (attempts >= constants.MAX_RETRIES) {
                logger.error('Max retries reached. Error fetching location details.');
                return { distrito: '', barrio: '', direccion: '', ciudad: '' };
            }
            await new Promise(resolve => setTimeout(resolve, constants.RETRY_DELAY));
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

            if (elements && elements.length > 0) {
                const station = elements.find(element => element.tags && element.tags.name);
                return station ? station.tags.name : null;
            } else {
                return null;
            }
        } catch (error) {
            attempts++;
            logger.error(`Attempt ${attempts} to get subway failed: ${error.message}`);
            if (attempts >= constants.MAX_RETRIES) {
                return null;
            }
            await new Promise(resolve => setTimeout(resolve, constants.RETRY_DELAY));
        }
    }
    return null;
}

async function deletePastEvents() {
    try {
        const collection = db.collection(constants.COLLECTION_NAME);
        const currentDate = new Date().toISOString();

        const result = await collection.deleteMany({
            dtend: { $lt: currentDate }
        });

        console.log(`Deleted ${result.deletedCount} past events`);
    } catch (error) {
        logger.error('Error deleting past events:', error.message);
    }
}

async function fetchAndStoreEvents() {
    try {
        const response = await axios.get(constants.EVENTS_API_URL);
        let eventsData = response.data;

        if (typeof eventsData === 'string') {
            eventsData = stripInvalidControlCharacters(eventsData);
            eventsData = JSON.parse(eventsData);
        }

        if (!eventsData || !eventsData['@graph']) {
            throw new Error('Unexpected API response structure: missing @graph');
        }

        const collection = db.collection(constants.COLLECTION_NAME);
        const subwaysCollection = db.collection('subways');

        const eventPromises = eventsData['@graph'].map(async (eventData) => {
            let locationDetails = { distrito: '', barrio: '', direccion: '', ciudad: '' };
            let nearestSubway = null;
            let imageUrl = null;
            let subwayLines = [];

            const existingEvent = await collection.findOne({ id: eventData.id });
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
                if (!locationDetails.distrito || !locationDetails.barrio || !locationDetails.direccion || !locationDetails.ciudad) {
                    locationDetails = await getLocationDetails(event.latitude, event.longitude);
                }

                event.distance = EventDomainService.calculateDistance(event, baseLat, baseLon);

                if (!nearestSubway) {
                    nearestSubway = await getNearestSubway(event.latitude, event.longitude);

                    if (nearestSubway) {
                        const normalizedSubway = normalizeString(nearestSubway);
                        const subwayData = await subwaysCollection.findOne({
                            subway: { $regex: new RegExp(`^${normalizedSubway}$`, 'i') }
                        });
                        if (subwayData) {
                            subwayLines = subwayData.lines;
                        }
                    }
                }
            }

            if (!imageUrl) {
                imageUrl = await scrapeImageFromUrl(event.link);
            }

            // Actualizar evento con los nuevos datos
            event.distrito = locationDetails.distrito;
            event.barrio = locationDetails.barrio;
            event.streetAddress = locationDetails.direccion;
            event.locality = locationDetails.ciudad;
            event.subway = nearestSubway || '';
            event.subwayLines = subwayLines;
            event.image = imageUrl;

            // Limpiar nombres de organización
            if (event.eventLocation) {
                event.eventLocation = cleanOrganizationName(event.eventLocation, event.distrito, event.barrio);
            }
            if (event.organizationName) {
                event.organizationName = cleanOrganizationName(event.organizationName, event.distrito, event.barrio);
            }

            await collection.updateOne(
                { id: event.id },
                { $set: event.toJSON() },
                { upsert: true }
            );
        });

        await Promise.all(eventPromises);
    } catch (error) {
        logger.error('Error fetching and storing events:', error.message);
    }
}

async function fetchAndStoreXmlEvents() {
    console.log('Starting XML events fetch and store process...');
    try {
        const response = await axios.get(constants.XML_EVENTS_API_URL);
        const xmlData = response.data;

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xmlData);

        if (!result || !result.serviceList || !result.serviceList.service) {
            throw new Error('Unexpected XML structure');
        }

        const totalEvents = result.serviceList.service.length;
        console.log(`Found ${totalEvents} events in XML feed`);

        const collection = db.collection(constants.COLLECTION_NAME);
        const subwaysCollection = db.collection('subways');

        const eventPromises = result.serviceList.service.map(async (xmlEvent) => {
            const event = EventDomainService.fromXMLData(xmlEvent);

            if (!event || !EventDomainService.isActive(event)) {
                return;
            }

            let locationDetails = { distrito: '', barrio: '', direccion: '', ciudad: '' };
            let nearestSubway = null;
            let subwayLines = [];

            const existingEvent = await collection.findOne({ id: event.id });

            if (existingEvent) {
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
                if (!locationDetails.distrito || !locationDetails.barrio || !locationDetails.direccion || !locationDetails.ciudad) {
                    locationDetails = await getLocationDetails(event.latitude, event.longitude);
                }

                event.distance = EventDomainService.calculateDistance(event, baseLat, baseLon);

                if (!nearestSubway) {
                    nearestSubway = await getNearestSubway(event.latitude, event.longitude);

                    if (nearestSubway) {
                        const normalizedSubway = normalizeString(nearestSubway);
                        const subwayData = await subwaysCollection.findOne({
                            subway: { $regex: new RegExp(`^${normalizedSubway}$`, 'i') }
                        });
                        if (subwayData) {
                            subwayLines = subwayData.lines;
                        }
                    }
                }
            }

            event.distrito = locationDetails.distrito;
            event.barrio = locationDetails.barrio;
            event.streetAddress = locationDetails.direccion;
            event.locality = locationDetails.ciudad;
            event.subway = nearestSubway || '';
            event.subwayLines = subwayLines;

            if (event.eventLocation) {
                event.eventLocation = cleanOrganizationName(event.eventLocation, event.distrito, event.barrio);
            }

            await collection.updateOne(
                { id: event.id },
                { $set: event.toJSON() },
                { upsert: true }
            );
        });

        await Promise.all(eventPromises);
        console.log('All XML events have been processed and stored');
    } catch (error) {
        console.error('Error in fetchAndStoreXmlEvents:', error);
        logger.error('Error fetching and storing XML events:', error.message);
    }
}

app.get('/recalculate', validateCoordinates, async (req, res) => {
    try {
        const { lat, lon } = req.query;

        console.log(`Current coordinates: ${baseLat}, ${baseLon}`);
        console.log(`New coordinates: ${lat}, ${lon}`);

        const newLat = parseFloat(lat).toFixed(2);
        const newLon = parseFloat(lon).toFixed(2);

        if (newLat !== baseLat.toFixed(2) || newLon !== baseLon.toFixed(2)) {
            baseLat = lat;
            baseLon = lon;

            console.log(`Recalculating distances with new base coordinates: ${baseLat}, ${baseLon}`);
            await fetchAndStoreEvents();

            res.json({ message: 'Recalculation completed with new coordinates', baseLat, baseLon });
        } else {
            res.status(400).json({ message: 'Coordinates are the same, no recalculation needed', baseLat, baseLon });
        }
    } catch (error) {
        logger.error('Error in recalculate service:', error.message);
        res.status(500).json({ error: 'An error occurred during recalculation', details: error.message });
    }
});

app.get('/getEvents', async (req, res) => {
    try {
        const { distrito_nombre, barrio_nombre } = req.query;
        const collection = db.collection(constants.COLLECTION_NAME);

        let query = {};
        if (distrito_nombre) query.distrito = distrito_nombre;
        if (barrio_nombre) query.barrio = barrio_nombre;

        const eventsData = await collection.find(query).toArray();
        const events = eventsData.map(eventData => EventDomainService.fromJSON(eventData));

        res.json(events.map(event => event.toJSON()));
    } catch (error) {
        logger.error('Error fetching events:', error.message);
        res.status(500).json({ error: 'An error occurred while fetching events', details: error.message });
    }
});

app.get('/getImage', async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) {
                    return res.status(400).json({ error: 'Missing id parameter' });
                }

                if (imageCache[id]) {
                    console.log('Returning image from cache for id:', id);
                    return res.json({ id, image: imageCache[id] });
                }

                const collection = db.collection(constants.COLLECTION_NAME);
                let eventData = await collection.findOne({ id: id });

                if (!eventData) {
                    return res.status(404).json({ error: 'Event not found' });
                }

                const event = EventDomainService.fromJSON(eventData);

                if (event.image) {
                    imageCache[id] = event.image;
                    return res.json({ id, image: event.image });
                }

                const imageUrl = await scrapeImageFromUrl(event.link);

                if (imageUrl) {
                    event.image = imageUrl;
                    await collection.updateOne({ id: id }, { $set: event.toJSON() });
                }

                imageCache[id] = imageUrl;

                res.json({ id, image: imageUrl });

            } catch (error) {
                logger.error('Error fetching image:', error.message);
                res.status(500).json({ error: 'An error occurred while fetching image', details: error.message });
            }
        });

        function normalizeString(str) {
            return str.toLowerCase();
        }

        app.get('/getSubwayLines', async (req, res) => {
            const { subway } = req.query;

            if (!subway) {
                return res.status(400).json({ error: 'Missing subway parameter' });
            }

            const normalizedSubway = normalizeString(subway);

            if (subwayCache[normalizedSubway]) {
                return res.json(subwayCache[normalizedSubway]);
            }

            try {
                const collection = db.collection('subways');

                const subwayData = await collection.findOne({
                    subway: { $regex: new RegExp(`^${normalizedSubway}$`, 'i') }
                });

                if (subwayData) {
                    const response = {
                        subway: subwayData.subway,
                        lines: subwayData.lines
                    };

                    subwayCache[normalizedSubway] = response;

                    res.json(response);
                } else {
                    res.status(404).json({ error: 'Subway station not found' });
                }
            } catch (error) {
                logger.error('Error fetching subway lines:', error.message);
                res.status(500).json({ error: 'An error occurred while fetching subway lines', details: error.message });
            }
        });

        app.use((err, req, res, next) => {
            logger.error(err.stack);
            res.status(500).json({
                error: 'An unexpected error occurred',
                details: process.env.NODE_ENV === 'development' ? err.message : 'No additional details available'
            });
        });

        async function connectToMongoDB() {
            try {
                const client = await MongoClient.connect(constants.MONGO_URI, {
                    useNewUrlParser: true,
                    useUnifiedTopology: true
                });
                db = client.db(constants.DB_NAME);
                console.log('Connected to MongoDB');
                return client;
            } catch (error) {
                logger.error('Error connecting to MongoDB:', error.message);
                process.exit(1);
            }
        }



        app.listen(constants.PORT, async () => {
            console.log(`Server running on port ${constants.PORT}`);
            await connectToMongoDB();
            await deletePastEvents();
            fetchAndStoreEvents();
            fetchAndStoreXmlEvents();

            setInterval(deletePastEvents, constants.UPDATE_INTERVAL);
            setInterval(fetchAndStoreEvents, constants.UPDATE_INTERVAL);
            setInterval(fetchAndStoreXmlEvents, constants.UPDATE_INTERVAL);
        });

        process.on('SIGINT', async () => {
            console.log('Closing MongoDB connection...');
            await db.close();
            process.exit(0);
        });