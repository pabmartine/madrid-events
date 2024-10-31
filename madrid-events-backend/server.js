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

const app = express();

let db;
let baseLat = constants.BASE_LAT;
let baseLon = constants.BASE_LON;

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

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI/180);
}

const allowedOrigins = constants.FRONTEND_URL.split(',');

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

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
            locality: xmlEvent.geoData[0].locality[0] || '',
            'postal-code': xmlEvent.geoData[0].zipcode[0],
            'street-address': xmlEvent.geoData[0].address[0],
            latitude: parseFloat(xmlEvent.geoData[0].latitude[0]),
            longitude: parseFloat(xmlEvent.geoData[0].longitude[0]),
            'organization-name': '',
            link: xmlEvent.basicData[0].web[0],
            image: null,
            distrito: '',
            barrio: '',
            distance: null,
            subway: '',
            subwayLines: [],
            'excluded-days': ''
        };

        if (xmlEvent.extradata && xmlEvent.extradata[0]) {
            const extradata = xmlEvent.extradata[0];

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
                    const subcategorias = categoria.subcategorias[0].subcategoria;
                    subcategorias.forEach(subcategoria => {
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

        if (xmlEvent.multimedia && xmlEvent.multimedia[0] && xmlEvent.multimedia[0].media) {
            const mediaItems = xmlEvent.multimedia[0].media;
            const imageMedia = mediaItems.find(media =>
                media.$?.type?.toLowerCase() === 'image' && media.url?.[0]
            );

            if (imageMedia) {
                mappedEvent.image = imageMedia.url[0];
            } else {
                mappedEvent.image = constants.IMAGE_NOT_FOUND;
            }
        } else {
            mappedEvent.image = constants.IMAGE_NOT_FOUND;
        }

        return mappedEvent;
    } catch (error) {
        logger.error('Error processing XML event:', error);
        return null;
    }
}

function convertDateFormat(dateStr) {
    const [day, month, year] = dateStr.split('/');
    const converted = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`;
    return converted;
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

        const eventPromises = eventsData['@graph'].map(async (event) => {
            let locationDetails = { distrito: '', barrio: '', direccion: '', ciudad: '' };
            let eventDistance = null;
            let nearestSubway = null;
            let imageUrl = null;
            let subwayLines = [];

            if (event.free === 0) {
                const lowercasePrice = event.price.toLowerCase();
                if (lowercasePrice.includes('gratis') || lowercasePrice.includes('gratuit')) {
                    event.free = 1;
                }
            }

            const existingEvent = await collection.findOne({ id: event.id });

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

                if (!locationDetails.distrito || !locationDetails.barrio || !locationDetails.direccion || !locationDetails.ciudad) {
                    locationDetails = await getLocationDetails(event.location.latitude, event.location.longitude);
                }

                if (eventDistance === null && event.location?.latitude && event.location?.longitude) {
                    eventDistance = calculateDistance(baseLat, baseLon, event.location.latitude, event.location.longitude);
                }

                if (!nearestSubway && event.location?.latitude && event.location?.longitude) {
                    nearestSubway = await getNearestSubway(event.location.latitude, event.location.longitude);

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

                if (!imageUrl) {
                    imageUrl = await scrapeImageFromUrl(event.link);
                }

            } else {
                if (event.location?.latitude && event.location?.longitude) {
                    locationDetails = await getLocationDetails(event.location.latitude, event.location.longitude);
                    eventDistance = calculateDistance(baseLat, baseLon, event.location.latitude, event.location.longitude);

                                        nearestSubway = await getNearestSubway(event.location.latitude, event.location.longitude);

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

                                    imageUrl = await scrapeImageFromUrl(event.link);
                                }

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
                                    'event-location': event['event-location']
                                        ? cleanOrganizationName(event['event-location'], locationDetails.distrito, locationDetails.barrio)
                                        : '',
                                    locality: event.address?.area?.locality || '',
                                    'postal-code': event.address?.area?.['postal-code'] || '',
                                    'street-address': event.address?.area?.['street-address'] || '',
                                    latitude: event.location?.latitude || null,
                                    longitude: event.location?.longitude || null,
                                    'organization-name': event.organization?.['organization-name']
                                        ? cleanOrganizationName(event.organization['organization-name'], locationDetails.distrito, locationDetails.barrio)
                                        : '',
                                    link: event.link || '',
                                    image: imageUrl,
                                    distrito: locationDetails.distrito,
                                    barrio: locationDetails.barrio,
                                    distance: eventDistance,
                                    subway: nearestSubway || '',
                                    subwayLines: subwayLines,
                                    'excluded-days': event['excluded-days'] || ''
                                };

                                await collection.updateOne(
                                    { id: mappedEvent.id },
                                    { $set: mappedEvent },
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

                            const eventPromises = result.serviceList.service.map(async (xmlEvent, index) => {
                                const mappedEvent = await processXmlEvent(xmlEvent);

                                if (!mappedEvent) {
                                    return;
                                }

                                let locationDetails = { distrito: '', barrio: '', direccion: '', ciudad: '' };
                                let eventDistance = null;
                                let nearestSubway = null;
                                let subwayLines = [];

                                const existingEvent = await collection.findOne({ id: mappedEvent.id });

                                if (existingEvent) {
                                    locationDetails = {
                                        distrito: existingEvent.distrito || '',
                                        barrio: existingEvent.barrio || '',
                                        direccion: existingEvent['street-address'] || '',
                                        ciudad: existingEvent.locality || ''
                                    };
                                    eventDistance = existingEvent.distance || null;
                                    nearestSubway = existingEvent.subway || null;
                                    subwayLines = existingEvent.subwayLines || [];

                                    if (!locationDetails.distrito || !locationDetails.barrio || !locationDetails.direccion || !locationDetails.ciudad) {
                                        locationDetails = await getLocationDetails(mappedEvent.latitude, mappedEvent.longitude);
                                    }

                                    if (eventDistance === null && mappedEvent.latitude && mappedEvent.longitude) {
                                        eventDistance = calculateDistance(baseLat, baseLon, mappedEvent.latitude, mappedEvent.longitude);
                                    }

                                    if (!nearestSubway && mappedEvent.latitude && mappedEvent.longitude) {
                                        nearestSubway = await getNearestSubway(mappedEvent.latitude, mappedEvent.longitude);

                                        if (nearestSubway) {
                                            const normalizedSubway = normalizeString(nearestSubway);
                                            const subwayData = await subwaysCollection.findOne({
                                                subway: { $regex: new RegExp(`^${normalizedSubway}$`, 'i') }
                                            });
                                            if (subwayData) {
                                                subwayLines = subwayData.lines;
                                            } else {
                                                console.log('No subway lines data found');
                                            }
                                        }
                                    }
                                } else {
                                    if (mappedEvent.latitude && mappedEvent.longitude) {
                                        locationDetails = await getLocationDetails(mappedEvent.latitude, mappedEvent.longitude);
                                        eventDistance = calculateDistance(baseLat, baseLon, mappedEvent.latitude, mappedEvent.longitude);
                                        nearestSubway = await getNearestSubway(mappedEvent.latitude, mappedEvent.longitude);

                                        if (nearestSubway) {
                                            const normalizedSubway = normalizeString(nearestSubway);
                                            const subwayData = await subwaysCollection.findOne({
                                                subway: { $regex: new RegExp(`^${normalizedSubway}$`, 'i') }
                                            });
                                            if (subwayData) {
                                                subwayLines = subwayData.lines;
                                            } else {
                                                console.log('No subway lines data found');
                                            }
                                        }
                                    } else {
                                        console.log('No coordinates available for this event');
                                    }
                                }

                                mappedEvent['street-address'] = mappedEvent['street-address'] || locationDetails.road;
                                mappedEvent.distrito = locationDetails.distrito;
                                mappedEvent.barrio = locationDetails.barrio;
                                mappedEvent.locality = locationDetails.ciudad;
                                mappedEvent.address = locationDetails.direccion;
                                mappedEvent.distance = eventDistance;
                                mappedEvent.subway = nearestSubway || '';
                                mappedEvent.subwayLines = subwayLines;

                                await collection.updateOne(
                                    { id: mappedEvent.id },
                                    { $set: mappedEvent },
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

                            const events = await collection.find(query).toArray();

                            res.json(events);
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
                            let event = await collection.findOne({ id: id });

                            if (event && event.image) {
                                imageCache[id] = event.image;
                                return res.json({ id, image: event.image });
                            }

                            const imageUrl = await scrapeImageFromUrl(event.link);

                            if (imageUrl) {
                                await collection.updateOne({ id: id }, { $set: { image: imageUrl } });
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