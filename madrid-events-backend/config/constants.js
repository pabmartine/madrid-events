// config/constants.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
    // Server configuration
    PORT: process.env.PORT || 5000,
    MONGO_URI: process.env.MONGO_URI,
    DB_NAME: process.env.DB_NAME || 'madrid-events',
    COLLECTION_NAME: process.env.COLLECTION_NAME || 'events',
    FRONTEND_URL: process.env.FRONTEND_URL,

    // Base coordinates
    BASE_LAT: 40.426794,
    BASE_LON: -3.637245,

    // Default image
    IMAGE_NOT_FOUND: "https://www.tea-tron.com/antorodriguez/blog/wp-content/uploads/2016/04/image-not-found-4a963b95bf081c3ea02923dceaeb3f8085e1a654fc54840aac61a57a60903fef.png",

    // API URLs
    EVENTS_API_URL: 'https://datos.madrid.es/egob/catalogo/206974-0-agenda-eventos-culturales-100.json',
    XML_EVENTS_API_URL: 'https://www.esmadrid.com/opendata/agenda_v1_es.xml',

    // API Configuration
    AXIOS_TIMEOUT: 5000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,

    // Rate limiting
    RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: 1000,

    // Cache settings
    CACHE_TTL: 24 * 60 * 60, // 24 hours in seconds

    // Update intervals
    UPDATE_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours in milliseconds

    // Nominatim API
    NOMINATIM_API_BASE: 'https://nominatim.openstreetmap.org/reverse',

    // Overpass API
    OVERPASS_API_BASE: 'https://overpass-api.de/api/interpreter'
};