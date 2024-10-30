const path = require('path');
require('dotenv').config({
    path: path.join(__dirname, '.env')
});
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const {
    MongoClient
} = require('mongodb');
const rateLimit = require("express-rate-limit");
const helmet = require('helmet');
const winston = require('winston');
const xml2js = require('xml2js');
const WebSocket = require('ws');

// Global constants
const CONSTANTS = {
    PORT: process.env.PORT || 5000,
    MONGO_URI: process.env.MONGO_URI,
    DB_NAME: process.env.DB_NAME || 'madrid-events',
    COLLECTION_NAME: process.env.COLLECTION_NAME || 'events',
    DEFAULT_IMAGE: "https://www.tea-tron.com/antorodriguez/blog/wp-content/uploads/2016/04/image-not-found-4a963b95bf081c3ea02923dceaeb3f8085e1a654fc54840aac61a57a60903fef.png",
    URLS: {
        JSON_EVENTS: 'https://datos.madrid.es/egob/catalogo/206974-0-agenda-eventos-culturales-100.json',
        XML_EVENTS: 'https://www.esmadrid.com/opendata/agenda_v1_es.xml'
    },
    NOMINATIM_BASE_URL: 'https://nominatim.openstreetmap.org/reverse',
    OVERPASS_BASE_URL: 'https://overpass-api.de/api/interpreter',
    CLEANUP_INTERVAL: 24 * 60 * 60 * 1000 // 24 horas
};

const app = express();
let db;
let wsServer;

// Base coordinates
let baseLat = 40.426794;
let baseLon = -3.637245;

// Enhanced Cache System
const Cache = {
    CACHE_TTL: 3600, // 1 hora en segundos
    eventCache: new NodeCache({
        stdTTL: 3600
    }),
    imageCache: new NodeCache({
        stdTTL: 86400
    }), // 24 horas para imágenes
    subwayCache: new NodeCache({
        stdTTL: 604800
    }), // 1 semana para datos de metro

    async getOrSet(key, fetchFn, cacheName = 'eventCache') {
        const cached = this[cacheName].get(key);
        if (cached) return cached;

        const value = await fetchFn();
        if (value) {
            this[cacheName].set(key, value);
        }
        return value;
    },

    clearExpired() {
        this.eventCache.prune();
        this.imageCache.prune();
        this.subwayCache.prune();
    }
};

// Retry Manager
const RetryManager = {
    DEFAULT_RETRY_OPTIONS: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 5000,
        factor: 2,
    },

    async withRetry(operation, options = {}) {
        const retryOptions = {
            ...this.DEFAULT_RETRY_OPTIONS,
            ...options
        };
        let lastError;

        for (let attempt = 0; attempt < retryOptions.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (attempt < retryOptions.maxRetries - 1) {
                    const delay = Math.min(
                        retryOptions.initialDelay * Math.pow(retryOptions.factor, attempt),
                        retryOptions.maxDelay
                    );
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw lastError;
    }
};

// Event Validator
const EventValidator = {
    requiredFields: ['title', 'description', 'dtstart', 'dtend'],

    validate(event) {
        const errors = [];

        this.requiredFields.forEach(field => {
            if (!event[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        });

        if (event.latitude && (event.latitude < -90 || event.latitude > 90)) {
            errors.push('Invalid latitude value');
        }

        if (event.longitude && (event.longitude < -180 || event.longitude > 180)) {
            errors.push('Invalid longitude value');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
};

// Enhanced Logger
const logger = winston.createLogger({
    levels: {
        error: 0,
        warn: 1,
        info: 2,
        debug: 3
    },
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({
            stack: true
        }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: 'error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: 'combined.log',
            level: 'info',
            maxsize: 5242880,
            maxFiles: 5,
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Data Cleaner
const DataCleaner = {
    async cleanupEvents(db) {
        const currentDate = new Date();
        const monthAgo = new Date(currentDate.setMonth(currentDate.getMonth() - 1));

        try {
            // Eliminar eventos antiguos
            const deleteResult = await db.collection(CONSTANTS.COLLECTION_NAME).deleteMany({
                dtend: {
                    $lt: monthAgo.toISOString()
                }
            });

            // Limpiar eventos inválidos
            const cleanResult = await db.collection(CONSTANTS.COLLECTION_NAME).deleteMany({
                $or: [{
                        dtstart: null
                    },
                    {
                        dtend: null
                    },
                    {
                        title: ""
                    }
                ]
            });

            // Actualizar eventos con campos faltantes
            const updateResult = await db.collection(CONSTANTS.COLLECTION_NAME).updateMany({
                image: null
            }, {
                $set: {
                    image: CONSTANTS.DEFAULT_IMAGE
                }
            });

            logger.info('Cleanup completed', {
                deletedOld: deleteResult.deletedCount,
                deletedInvalid: cleanResult.deletedCount,
                updatedImages: updateResult.modifiedCount
            });
        } catch (error) {
            logger.error('Error in cleanup process:', error);
        }
    }
};

// Rate Limiting Configuration
const rateLimitConfig = {
    standard: {
        windowMs: 15 * 60 * 1000,
        max: 100
    },
    authenticated: {
        windowMs: 15 * 60 * 1000,
        max: 1000
    },
    ipWhitelist: new Set(['127.0.0.1'])
};

const customRateLimit = rateLimit({
    windowMs: rateLimitConfig.standard.windowMs,
    max: (req) => {
        const clientIp = req.ip;
        if (rateLimitConfig.ipWhitelist.has(clientIp)) {
            return rateLimitConfig.authenticated.max;
        }
        return rateLimitConfig.standard.max;
    }
});

// Search Engine
const SearchEngine = {
    async searchEvents(db, query) {
        const collection = db.collection(CONSTANTS.COLLECTION_NAME);

        const searchQuery = {
            $or: [{
                    title: {
                        $regex: query.searchText || '',
                        $options: 'i'
                    }
                },
                {
                    description: {
                        $regex: query.searchText || '',
                        $options: 'i'
                    }
                },
                {
                    'event-location': {
                        $regex: query.searchText || '',
                        $options: 'i'
                    }
                }
            ]
        };

        if (query.startDate) {
            searchQuery.dtstart = {
                $gte: query.startDate
            };
        }

        if (query.endDate) {
            searchQuery.dtend = {
                $lte: query.endDate
            };
        }

        if (query.free === true) {
            searchQuery.free = true;
        }

        if (query.distrito) {
            searchQuery.distrito = query.distrito;
        }

        if (query.barrio) {
            searchQuery.barrio = query.barrio;
        }

        return collection.find(searchQuery).toArray();
    }
};

// WebSocket Manager
const WebSocketManager = {
    setup: (server) => {
        const wss = new WebSocket.Server({
            server
        });

        wss.on('connection', (ws) => {
            logger.info('New WebSocket connection');

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'subscribe') {
                        ws.subscribed = true;
                        ws.subscriptionData = data.filters || {};
                        logger.info('Client subscribed to updates', {
                            filters: data.filters
                        });
                    }
                } catch (error) {
                    logger.error('WebSocket message error:', error);
                }
            });

            ws.on('close', () => {
                logger.info('Client disconnected');
            });
        });

        return {
            broadcast: (message) => {
                wss.clients.forEach((client) => {
                    if (client.subscribed) {
                        // Filtrar mensajes según las preferencias del cliente
                        const shouldSend = !client.subscriptionData ||
                            Object.entries(client.subscriptionData).every(([key, value]) =>
                                message[key] === value
                            );

                        if (shouldSend) {
                            client.send(JSON.stringify(message));
                        }
                    }
                });
            }
        };
    }
};

// Axios configuration
axios.defaults.timeout = 5000;
axios.interceptors.response.use(null, (error) => {
    if (error.config && error.response && error.response.status >= 500) {
        return axios.request(error.config);
    }
    return Promise.reject(error);
});

// Security configuration
app.use(helmet());
app.use(customRateLimit);

// CORS configuration
const allowedOrigins = process.env.FRONTEND_URL.split(',');
app.use(cors({
    origin: function(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));

// Utility functions
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

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function normalizeString(str) {
    return str.toLowerCase();
}

// Location and transportation functions
async function getLocationDetails(latitude, longitude) {
    return RetryManager.withRetry(async () => {
        const response = await axios.get(`${CONSTANTS.NOMINATIM_BASE_URL}?lat=${latitude}&lon=${longitude}&format=json`);
        const {
            address
        } = response.data;
        return {
            distrito: address.quarter || '',
            barrio: address.suburb || '',
            direccion: address.road || '',
            ciudad: address.city || ''
        };
    });
}

async function getNearestSubway(lat, lon) {
    const cacheKey = `subway-${lat}-${lon}`;
    return Cache.getOrSet(cacheKey, async () => {
        return RetryManager.withRetry(async () => {
            const overpassQuery = `[out:json];node(around:1000,${lat},${lon})[railway=station][operator="Metro de Madrid"];out;`;
            const response = await axios.get(`${CONSTANTS.OVERPASS_BASE_URL}?data=${encodeURIComponent(overpassQuery)}`);
            const elements = response.data.elements;

            if (elements && elements.length > 0) {
                const station = elements.find(element => element.tags && element.tags.name);
                return station ? station.tags.name : null;
            }
            return null;
        });
    }, 'subwayCache');
}

async function scrapeImageFromUrl(url) {
    return RetryManager.withRetry(async () => {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const imageElement = $('.image-content img');
        let imageUrl = imageElement.attr('src');

        if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = `https://www.madrid.es${imageUrl}`;
        }
        return imageUrl || CONSTANTS.DEFAULT_IMAGE;
    });
}

// Event processing functions
async function processEvent(event, existingEvent = null) {
    let locationDetails = {
        distrito: '',
        barrio: '',
        direccion: '',
        ciudad: ''
    };
    let eventDistance = null;
    let nearestSubway = null;
    let subwayLines = [];
    let imageUrl = null;

    const latitude = event.latitude || event.location?.latitude;
    const longitude = event.longitude || event.location?.longitude;

    if (existingEvent) {
        locationDetails = {
            distrito: existingEvent.distrito || '',
            barrio: existingEvent.barrio || '',
            direccion: existingEvent['street-address'] || '',
            ciudad: existingEvent.locality || ''
        };
        eventDistance = existingEvent.distance || null;
        nearestSubway = existingEvent.subway || null;
        imageUrl = existingEvent.image || null;
        subwayLines = existingEvent.subwayLines || [];
        // Update missing data
        if (latitude && longitude) {
            if (!locationDetails.distrito || !locationDetails.barrio) {
                locationDetails = await getLocationDetails(latitude, longitude);
            }

            if (eventDistance === null) {
                eventDistance = calculateDistance(baseLat, baseLon, latitude, longitude);
            }

            if (!nearestSubway) {
                nearestSubway = await getNearestSubway(latitude, longitude);
                if (nearestSubway) {
                    const normalizedSubway = normalizeString(nearestSubway);
                    const subwayData = await db.collection('subways').findOne({
                        subway: {
                            $regex: new RegExp(`^${normalizedSubway}$`, 'i')
                        }
                    });
                    if (subwayData) {
                        subwayLines = subwayData.lines;
                    }
                }
            }
        }
    } else {
        if (latitude && longitude) {
            locationDetails = await getLocationDetails(latitude, longitude);
            eventDistance = calculateDistance(baseLat, baseLon, latitude, longitude);
            nearestSubway = await getNearestSubway(latitude, longitude);

            if (nearestSubway) {
                const normalizedSubway = normalizeString(nearestSubway);
                const subwayData = await db.collection('subways').findOne({
                    subway: {
                        $regex: new RegExp(`^${normalizedSubway}$`, 'i')
                    }
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

    return {
        locationDetails,
        eventDistance,
        nearestSubway,
        subwayLines,
        imageUrl
    };
}

async function processJsonEvent(event) {
    const existingEvent = await db.collection(CONSTANTS.COLLECTION_NAME).findOne({
        id: event.id
    });
    const processedData = await processEvent(event, existingEvent);

    const mappedEvent = {
        id: event.id || '',
        title: event.title || '',
        description: event.description || '',
        free: event.free || false,
        price: event.price || '',
        dtstart: event.dtstart || '',
        dtend: event.dtend || '',
        time: event.time || '',
        audience: Array.isArray(event.audience) ? event.audience : [event.audience || ''],
        'event-location': event['event-location'] ?
            cleanOrganizationName(event['event-location'], processedData.locationDetails.distrito, processedData.locationDetails.barrio) :
            '',
        locality: event.address?.area?.locality || '',
        'postal-code': event.address?.area?.['postal-code'] || '',
        'street-address': event.address?.area?.['street-address'] || '',
        latitude: event.location?.latitude || null,
        longitude: event.location?.longitude || null,
        'organization-name': event.organization?.['organization-name'] ?
            cleanOrganizationName(event.organization['organization-name'], processedData.locationDetails.distrito, processedData.locationDetails.barrio) :
            '',
        link: event.link || '',
        image: processedData.imageUrl,
        distrito: processedData.locationDetails.distrito,
        barrio: processedData.locationDetails.barrio,
        distance: processedData.eventDistance,
        subway: processedData.nearestSubway || '',
        subwayLines: processedData.subwayLines,
        'excluded-days': event['excluded-days'] || ''
    };

    const validation = EventValidator.validate(mappedEvent);
    if (!validation.isValid) {
        logger.warn('Invalid event data:', {
            eventId: mappedEvent.id,
            errors: validation.errors
        });
    }

    return mappedEvent;
}

function convertDateFormat(dateStr) {
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`;
}

async function processXmlEvent(xmlEvent) {
    try {
        const mappedEvent = {
            id: `xml-${xmlEvent.$.id}`,
            title: xmlEvent.basicData[0].title[0].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim(),
            description: xmlEvent.basicData[0].body[0].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim(),
            free: false,
            price: '',
            dtstart: '',
            dtend: '',
            time: '',
            audience: [],
            'event-location': xmlEvent.geoData[0].address[0],
            latitude: parseFloat(xmlEvent.geoData[0].latitude[0]),
            longitude: parseFloat(xmlEvent.geoData[0].longitude[0]),
            link: xmlEvent.basicData[0].web[0],
            image: null
        };

        if (xmlEvent.extradata && xmlEvent.extradata[0]) {
            const extradata = xmlEvent.extradata[0];

            // Process categories
            if (extradata.categorias && extradata.categorias[0].categoria) {
                const categoria = extradata.categorias[0].categoria[0];
                if (categoria.item) {
                    const categoriaItem = categoria.item.find(item =>
                        item.$ && item.$.name === 'Categoria');
                    if (categoriaItem && categoriaItem._) {
                        mappedEvent.audience.push(categoriaItem._);
                    }
                }

                if (categoria.subcategorias && categoria.subcategorias[0].subcategoria) {
                    categoria.subcategorias[0].subcategoria.forEach(subcategoria => {
                        if (subcategoria.item) {
                            const subcategoriaItem = subcategoria.item.find(item =>
                                item.$ && item.$.name === 'SubCategoria');
                            if (subcategoriaItem && subcategoriaItem._) {
                                mappedEvent.audience.push(subcategoriaItem._);
                            }
                        }
                    });
                }
            }

            // Process price and schedule
            if (extradata.item) {
                const serviciosPago = extradata.item.find(item =>
                    item.$ && item.$.name === 'Servicios de pago' && item._);
                if (serviciosPago) {
                    const precioText = serviciosPago._
                        .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
                        .replace(/<[^>]*>/g, '')
                        .trim();
                    mappedEvent.price = precioText;
                    mappedEvent.free = precioText.toLowerCase().includes('gratuito') ||
                        precioText.toLowerCase().includes('gratis');
                }

                const horario = extradata.item.find(item =>
                    item.$ && item.$.name === 'Horario' && item._);
                if (horario) {
                    mappedEvent.time = horario._
                        .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
                        .replace(/<[^>]*>/g, '')
                        .trim();
                }
            }

            // Process dates
            if (extradata.fechas && extradata.fechas[0].rango) {
                const rango = extradata.fechas[0].rango[0];
                mappedEvent.dtstart = convertDateFormat(rango.inicio[0]);
                mappedEvent.dtend = convertDateFormat(rango.fin[0]);

                const currentDate = new Date();
                const endDate = new Date(mappedEvent.dtend);
                if (endDate < currentDate) {
                    return null;
                }
            }
        }

        const existingEvent = await db.collection(CONSTANTS.COLLECTION_NAME).findOne({
            id: mappedEvent.id
        });
        const processedData = await processEvent(mappedEvent, existingEvent);

        const finalEvent = {
            ...mappedEvent,
            distrito: processedData.locationDetails.distrito,
            barrio: processedData.locationDetails.barrio,
            locality: processedData.locationDetails.ciudad,
            'street-address': processedData.locationDetails.direccion,
            distance: processedData.eventDistance,
            subway: processedData.nearestSubway || '',
            subwayLines: processedData.subwayLines,
            image: processedData.imageUrl || mappedEvent.image
        };

        const validation = EventValidator.validate(finalEvent);
        if (!validation.isValid) {
            logger.warn('Invalid XML event data:', {
                eventId: finalEvent.id,
                errors: validation.errors
            });
        }

        return finalEvent;
    } catch (error) {
        logger.error('Error processing XML event:', error);
        return null;
    }
}

// Event fetching and storing functions
async function fetchAndStoreEvents() {
    try {
        const response = await RetryManager.withRetry(() =>
            axios.get(CONSTANTS.URLS.JSON_EVENTS)
        );

        let eventsData = response.data;

        if (typeof eventsData === 'string') {
            eventsData = stripInvalidControlCharacters(eventsData);
            eventsData = JSON.parse(eventsData);
        }

        if (!eventsData || !eventsData['@graph']) {
            throw new Error('Unexpected API response structure: missing @graph');
        }

        const collection = db.collection(CONSTANTS.COLLECTION_NAME);
        const processedEvents = await Promise.all(
            eventsData['@graph'].map(event => processJsonEvent(event))
        );

        const validEvents = processedEvents.filter(event => {
            const validation = EventValidator.validate(event);
            return validation.isValid;
        });

        for (const event of validEvents) {
            await collection.updateOne({
                id: event.id
            }, {
                $set: event
            }, {
                upsert: true
            });

            // Notify connected clients about new/updated event
            if (wsServer) {
                wsServer.broadcast({
                    type: 'eventUpdate',
                    event: event
                });
            }
        }

        logger.info(`Processed ${validEvents.length} JSON events`);
    } catch (error) {
        logger.error('Error fetching and storing JSON events:', error);
    }
}

async function fetchAndStoreXmlEvents() {
    try {
        const response = await RetryManager.withRetry(() =>
            axios.get(CONSTANTS.URLS.XML_EVENTS)
        );

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(response.data);

        if (!result || !result.serviceList || !result.serviceList.service) {
            throw new Error('Unexpected XML structure');
        }

        const collection = db.collection(CONSTANTS.COLLECTION_NAME);
        const processedEvents = await Promise.all(
            result.serviceList.service.map(xmlEvent => processXmlEvent(xmlEvent))
        );

        const validEvents = processedEvents.filter(event => {
            if (!event) return false;
            const validation = EventValidator.validate(event);
            return validation.isValid;
        });

        for (const event of validEvents) {
            await collection.updateOne({
                id: event.id
            }, {
                $set: event
            }, {
                upsert: true
            });

            // Notify connected clients about new/updated event
            if (wsServer) {
                wsServer.broadcast({
                    type: 'eventUpdate',
                    event: event
                });
            }
        }

        logger.info(`Processed ${validEvents.length} XML events`);
    } catch (error) {
        logger.error('Error fetching and storing XML events:', error);
    }
}

// API Routes
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

app.get('/recalculate', validateCoordinates, async (req, res) => {
    try {
        const {
            lat,
            lon
        } = req.query;
        const newLat = parseFloat(lat).toFixed(2);
        const newLon = parseFloat(lon).toFixed(2);

        if (newLat !== baseLat.toFixed(2) || newLon !== baseLon.toFixed(2)) {
            baseLat = parseFloat(lat);
            baseLon = parseFloat(lon);
            await fetchAndStoreEvents();
            await fetchAndStoreXmlEvents();
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
        logger.error('Error in recalculate service:', error);
        res.status(500).json({
            error: 'An error occurred during recalculation',
            details: error.message
        });
    }
});

app.get('/search', async (req, res) => {
    try {
        const searchResults = await SearchEngine.searchEvents(db, req.query);
        res.json(searchResults);
    } catch (error) {
        logger.error('Error in search service:', error);
        res.status(500).json({
            error: 'An error occurred during search',
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
        const collection = db.collection(CONSTANTS.COLLECTION_NAME);

        let query = {};
        if (distrito_nombre) query.distrito = distrito_nombre;
        if (barrio_nombre) query.barrio = barrio_nombre;

        const events = await collection.find(query).toArray();
        res.json(events);
    } catch (error) {
        logger.error('Error fetching events:', error);
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

        const cachedImage = await Cache.getOrSet(
            `image-${id}`,
            async () => {
                    const collection = db.collection(CONSTANTS.COLLECTION_NAME);
                    const event = await collection.findOne({
                        id: id
                    });

                    if (event && event.image) {
                        return event.image;
                    }

                    const imageUrl = await scrapeImageFromUrl(event.link);
                    if (imageUrl) {
                        await collection.updateOne({
                            id: id
                        }, {
                            $set: {
                                image: imageUrl
                            }
                        });
                    }
                    return imageUrl;
                },
                'imageCache'
        );

        res.json({
            id,
            image: cachedImage
        });
    } catch (error) {
        logger.error('Error fetching image:', error);
        res.status(500).json({
            error: 'An error occurred while fetching image',
            details: error.message
        });
    }
});

app.get('/getSubwayLines', async (req, res) => {
    const {
        subway
    } = req.query;
    if (!subway) {
        return res.status(400).json({
            error: 'Missing subway parameter'
        });
    }

    const normalizedSubway = normalizeString(subway);

    try {
        const subwayData = await Cache.getOrSet(
            `subway-${normalizedSubway}`,
            async () => {
                    const collection = db.collection('subways');
                    const data = await collection.findOne({
                        subway: {
                            $regex: new RegExp(`^${normalizedSubway}$`, 'i')
                        }
                    });

                    if (data) {
                        return {
                            subway: data.subway,
                            lines: data.lines
                        };
                    }
                    return null;
                },
                'subwayCache'
        );

        if (subwayData) {
            res.json(subwayData);
        } else {
            res.status(404).json({
                error: 'Subway station not found'
            });
        }
    } catch (error) {
        logger.error('Error fetching subway lines:', error);
        res.status(500).json({
            error: 'An error occurred while fetching subway lines',
            details: error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? err.message : 'No additional details available'
    });
});

// Database connection
async function connectToMongoDB() {
    try {
        const client = await MongoClient.connect(CONSTANTS.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        db = client.db(CONSTANTS.DB_NAME);
        logger.info('Connected to MongoDB');
        return client;
    } catch (error) {
        logger.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
}

// Periodic tasks
function setupPeriodicTasks() {
    // Limpiar eventos pasados y datos inválidos
    setInterval(() => {
        DataCleaner.cleanupEvents(db);
    }, CONSTANTS.CLEANUP_INTERVAL);

    // Actualizar eventos
    setInterval(async () => {
        await fetchAndStoreEvents();
        await fetchAndStoreXmlEvents();
    }, CONSTANTS.CLEANUP_INTERVAL);

    // Limpiar cachés expirados
    setInterval(() => {
        Cache.clearExpired();
    }, 3600000); // Cada hora
}

// Server initialization
const server = app.listen(CONSTANTS.PORT, async () => {
    try {
        logger.info(`Server running on port ${CONSTANTS.PORT}`);

        // Inicializar conexión a MongoDB
        await connectToMongoDB();

        // Configurar WebSocket
        wsServer = WebSocketManager.setup(server);

        // Realizar limpieza inicial
        await DataCleaner.cleanupEvents(db);

        // Cargar datos iniciales
        await fetchAndStoreEvents();
        await fetchAndStoreXmlEvents();

        // Configurar tareas periódicas
        setupPeriodicTasks();

        logger.info('Server initialization completed successfully');
    } catch (error) {
        logger.error('Error during server initialization:', error);
        process.exit(1);
    }
});

// Graceful shutdown
process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

async function handleShutdown(signal) {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Cerrar servidor HTTP
    server.close(() => {
        logger.info('HTTP server closed');
    });

    try {
        // Cerrar conexión WebSocket
        if (wsServer) {
            wsServer.clients.forEach(client => {
                client.close();
            });
        }

        // Cerrar conexión MongoDB
        if (db) {
            await db.client.close();
            logger.info('MongoDB connection closed');
        }

        logger.info('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
    }
}

// Export for testing
module.exports = {
    app,
    Cache,
    RetryManager,
    EventValidator,
    SearchEngine,
    DataCleaner
};