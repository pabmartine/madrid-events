// services/cache.js
const NodeCache = require('node-cache');
const logger = require('../config/logger');

const CACHE_TTL = {
    IMAGES: 7 * 24 * 60 * 60,  // 1 semana
    SUBWAY_LINES: 24 * 60 * 60, // 1 día
    EVENTS: 60 * 60            // 1 hora
};

class CacheService {
    constructor() {
        this.cache = new NodeCache({
            checkperiod: 60 * 10, // Revisar items expirados cada 10 minutos
            useClones: false      // Para mejor rendimiento
        });

        // Log cuando los items expiren
        this.cache.on('expired', (key, value) => {
            logger.info('Cache item expired', { key });
        });
    }

    // Métodos genéricos
    get(key) {
        try {
            return this.cache.get(key);
        } catch (error) {
            logger.error('Error getting from cache', { key, error });
            return null;
        }
    }

    set(key, value, ttl) {
        try {
            return this.cache.set(key, value, ttl);
        } catch (error) {
            logger.error('Error setting cache', { key, error });
        }
    }

    del(key) {
        try {
            return this.cache.del(key);
        } catch (error) {
            logger.error('Error deleting from cache', { key, error });
        }
    }

    // Métodos específicos para imágenes
    getImage(id) {
        return this.get(`image:${id}`);
    }

    setImage(id, url) {
        return this.set(`image:${id}`, url, CACHE_TTL.IMAGES);
    }

    // Métodos específicos para líneas de metro
    getSubwayLines(name) {
        return this.get(`subway:${name.toLowerCase()}`);
    }

    setSubwayLines(name, lines) {
        return this.set(`subway:${name.toLowerCase()}`, lines, CACHE_TTL.SUBWAY_LINES);
    }

    // Métodos específicos para eventos
    getEvents(distrito, barrio) {
        const key = `events:${distrito || 'all'}:${barrio || 'all'}`;
        return this.get(key);
    }

    setEvents(events, distrito, barrio) {
        const key = `events:${distrito || 'all'}:${barrio || 'all'}`;
        return this.set(key, events, CACHE_TTL.EVENTS);
    }

    // Método para limpiar caché por patrón
    clearPattern(pattern) {
        const keys = this.cache.keys();
        const matchingKeys = keys.filter(key => key.includes(pattern));
        this.cache.del(matchingKeys);
        logger.info('Cache cleared', { pattern, keysCleared: matchingKeys.length });
    }

    // Método para obtener estadísticas
    getStats() {
        return this.cache.getStats();
    }
}

module.exports = new CacheService();