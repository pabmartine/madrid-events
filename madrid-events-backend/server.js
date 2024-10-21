const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
console.log('MONGO_URI:', process.env.MONGO_URI);
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const { MongoClient } = require('mongodb');
const rateLimit = require("express-rate-limit");
const helmet = require('helmet');
const winston = require('winston');  // Importar Winston

const app = express();
const port = process.env.PORT || 5000;

const mongoURI = process.env.MONGO_URI;
const dbName = process.env.DB_NAME || 'madrid-events';
const collectionName = process.env.COLLECTION_NAME || 'events';

const imageNotFound = "https://www.tea-tron.com/antorodriguez/blog/wp-content/uploads/2016/04/image-not-found-4a963b95bf081c3ea02923dceaeb3f8085e1a654fc54840aac61a57a60903fef.png";

let db;

// Crear un logger personalizado usando Winston
const logger = winston.createLogger({
    level: 'error',  // Solo loguea a partir del nivel 'error'
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        // Transport para mostrar solo los errores en la consola
        new winston.transports.Console({
            level: 'error',  // Mostrar solo errores
            format: winston.format.combine(
                winston.format.colorize(),   // Colores en consola para legibilidad
                winston.format.simple()      // Mostrar solo mensaje simple en consola
            )
        }),
        // Transport opcional para escribir errores en archivo
        new winston.transports.File({ filename: 'error.log', level: 'error' })
    ]
});

// Configuración de Axios para manejar timeouts y reintentos
axios.defaults.timeout = 5000; // 5 segundos de timeout

axios.interceptors.response.use(null, (error) => {
    if (error.config && error.response && error.response.status >= 500) {
        // Reintentar la solicitud si falló por error de servidor
        return axios.request(error.config);
    }
    return Promise.reject(error);
});

// Declare global variables for base coordinates
let baseLat = 40.426794;
let baseLon = -3.637245;

// Caché en memoria para las estaciones de metro y sus líneas
const subwayCache = {};

// Cache en memoria para almacenar las imágenes asociadas a sus URLs
const imageCache = {};

// Aplicar helmet para añadir headers de seguridad
app.use(helmet());

// Aplicar rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1000 // límite de 1000 solicitudes por ventana por IP
});
app.use(limiter);

// Resto del código...

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

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

async function scrapeImageFromUrl(url) {
    try {
        console.log('scraping image from for URL:', url);
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const imageElement = $('.image-content img');
        let imageUrl = imageElement.attr('src');
        
        if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = `https://www.madrid.es${imageUrl}`;
        }

        console.log('Obtained:', imageUrl || null);

        return imageUrl || imageNotFound;
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

async function getLocationDetails(latitude, longitude, maxRetries = 3, retryDelay = 1000) {
    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
            const { address } = response.data;
            return {
                distrito: address.quarter || '',
                barrio: address.suburb || ''
            };
        } catch (error) {
            attempts++;
            logger.error(`Attempt ${attempts} failed: ${error.message}`);
            if (attempts >= maxRetries) {
                logger.error('Max retries reached. Error fetching location details.');
                return { distrito: '', barrio: '' };
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}

async function getNearestSubway(lat, lon, maxRetries = 3, retryDelay = 1000) {
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=[out:json];node(around:1000,${lat},${lon})[railway=station][operator="Metro de Madrid"];out;`;
    let attempts = 0;
    while (attempts < maxRetries) {
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
            if (attempts >= maxRetries) {
                return null;
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
    return null;
}

async function deletePastEvents() {
    try {
        const collection = db.collection(collectionName);
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

        // Delete past events before fetching new ones
        await deletePastEvents();
        
        const url = 'https://datos.madrid.es/egob/catalogo/206974-0-agenda-eventos-culturales-100.json';
        const response = await axios.get(url);
        let eventsData = response.data;

        if (typeof eventsData === 'string') {
            eventsData = stripInvalidControlCharacters(eventsData);
            eventsData = JSON.parse(eventsData);
        }

        if (!eventsData || !eventsData['@graph']) {
            throw new Error('Unexpected API response structure: missing @graph');
        }

        const collection = db.collection(collectionName);
        const subwaysCollection = db.collection('subways');

        const eventPromises = eventsData['@graph'].map(async (event) => {
            let locationDetails = { distrito: '', barrio: '' };
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
                    barrio: existingEvent.barrio || ''
                };
                eventDistance = existingEvent.distance || null;
                nearestSubway = existingEvent.subway || null;
                imageUrl = existingEvent.image || null;
                subwayLines = existingEvent.subwayLines || [];
            } else {
                if (event.location?.latitude && event.location?.longitude) {
                    locationDetails = await getLocationDetails(event.location.latitude, event.location.longitude);
                }

                if (event.location?.latitude && event.location?.longitude) {
                    eventDistance = calculateDistance(baseLat, baseLon, event.location.latitude, event.location.longitude);
                }

                if (event.location?.latitude && event.location?.longitude) {
                    nearestSubway = await getNearestSubway(event.location.latitude, event.location.longitude);
                }

                imageUrl = await scrapeImageFromUrl(event.link);

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

            const mappedEvent = {
                id: event.id || '',
                title: event.title || '',
                description: event.description || '',
                free: event.free || false,
                price: event.price || '',
                dtstart: event.dtstart || '',
                dtend: event.dtend || '',
                time: event.time || '',
                audience: event.audience || '',
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

// Nuevo servicio de recalculación con validación
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
        const collection = db.collection(collectionName);

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

        const collection = db.collection(collectionName);
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

// Middleware de manejo de errores global
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({
    error: 'An unexpected error occurred',
    details: process.env.NODE_ENV === 'development' ? err.message : 'No additional details available'
  });
});

async function connectToMongoDB() {
  try {
    const client = await MongoClient.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });
    db = client.db(dbName);
    console.log('Connected to MongoDB');
    return client;
  } catch (error) {
    logger.error('Error connecting to MongoDB:', error.message);
    process.exit(1);
  }
}

async function startServer() {
  const client = await connectToMongoDB();
  
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    fetchAndStoreEvents();
    setInterval(fetchAndStoreEvents, 24 * 60 * 60 * 1000);
  });

  process.on('SIGINT', async () => {
    await client.close();
    console.log('MongoDB connection closed');
    process.exit(0);
  });
}

startServer();
