const logger = require('../config/logger');
const axios = require('../config/axios');
const constants = require('../config/constants');

class LocationQueue {
    constructor(db) {
        if (!db) {
            throw new Error('Database connection is required for LocationQueue');
        }
        this.queue = [];
        this.isProcessing = false;
        this.shouldStop = false;
        this.blockedUntil = null;
        this.db = db;
        this.collection = db.collection(constants.COLLECTION_NAME);

        // Iniciar el procesamiento
        this.startProcessing();
        logger.info('LocationQueue initialized');
    }

    /**
     * Obtiene los detalles de ubicación para unas coordenadas dadas
     * Si no están en la base de datos, encola la petición y devuelve valores vacíos
     */
    async getLocationDetails(latitude, longitude, eventId) {
        try {
            if (!eventId) {
                logger.error('No eventId provided for location details');
                return {
                    distrito: '',
                    barrio: '',
                    direccion: '',
                    ciudad: ''
                };
            }

            // Verificar si ya tenemos los datos en la base de datos
            const existingEvent = await this.collection.findOne({ id: eventId });

            // Si ya tenemos todos los datos de ubicación, los devolvemos
            if (existingEvent &&
                (existingEvent.distrito || existingEvent.barrio) &&
                existingEvent.streetAddress &&
                existingEvent.locality) {
                logger.debug('Returning existing location details', {
                    eventId,
                    distrito: existingEvent.distrito
                });
                return {
                    distrito: existingEvent.distrito,
                    barrio: existingEvent.barrio,
                    direccion: existingEvent.streetAddress,
                    ciudad: existingEvent.locality
                };
            }

            // Si no tenemos datos completos, encolamos la petición
            await this.enqueue(latitude, longitude, eventId);
            logger.debug('Location request enqueued for incomplete data', {
                eventId,
                queueSize: this.queue.length
            });

            // Devolvemos los datos que tengamos (o valores vacíos si no hay nada)
            return {
                distrito: existingEvent?.distrito || '',
                barrio: existingEvent?.barrio || '',
                direccion: existingEvent?.streetAddress || '',
                ciudad: existingEvent?.locality || ''
            };

        } catch (error) {
            logger.error('Error in getLocationDetails:', {
                error: error.message,
                stack: error.stack,
                eventId,
                latitude,
                longitude
            });

            return {
                distrito: '',
                barrio: '',
                direccion: '',
                ciudad: ''
            };
        }
    }

    async enqueue(latitude, longitude, eventId) {
        if (latitude == null || longitude == null) {
            logger.warn('Skipping enqueue due to missing coordinates', { eventId });
            return;
        }

        if (this.queue.length >= constants.MAX_QUEUE_LENGTH) {
            const dropped = this.queue.shift();
            logger.warn('Location queue reached max length, dropping oldest request', {
                droppedEventId: dropped?.eventId
            });
        }

        logger.debug('Enqueueing location request', {
            eventId,
            latitude,
            longitude,
            queueLength: this.queue.length
        });

        // Verificar si ya existe en la cola
        const existingRequest = this.queue.find(req =>
            req.eventId === eventId &&
            req.latitude === latitude &&
            req.longitude === longitude
        );

        if (!existingRequest) {
            this.queue.push({
                latitude,
                longitude,
                eventId,
                timestamp: new Date(),
                retries: 0
            });
        }
    }

    async startProcessing() {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        this.processQueue();
    }

        stopProcessing() {
            logger.info('Stopping location queue processing...');
            this.shouldStop = true;
        }

    async processQueue() {
        while (!this.shouldStop) {
            if (this.queue.length === 0) {
                await new Promise(resolve => setTimeout(resolve, constants.QUEUE_REQUEST_DELAY_MS));
                continue;
            }

            // Check if service is temporarily blocked
            if (this.blockedUntil && new Date() < this.blockedUntil) {
                const waitTime = this.blockedUntil.getTime() - new Date().getTime();
                logger.warn('Nominatim service is temporarily blocked/unreachable. Pausing queue.', {
                    blockedUntil: this.blockedUntil,
                    waitingForMs: waitTime
                });
                await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 30000))); // Check every 30s
                continue;
            } else if (this.blockedUntil) {
                logger.info('Resuming Nominatim service processing after block period.');
                this.blockedUntil = null;
            }

            const request = this.queue.shift();
            let delayMs = constants.QUEUE_REQUEST_DELAY_MS;
            logger.debug('Processing location request from queue', {
                eventId: request.eventId,
                queueLength: this.queue.length
            });

            try {
                const params = new URLSearchParams({
                    lat: String(request.latitude),
                    lon: String(request.longitude),
                    format: 'json'
                });
                if (constants.NOMINATIM_EMAIL) {
                    params.append('email', constants.NOMINATIM_EMAIL);
                }
                const url = `${constants.NOMINATIM_API_BASE}?${params.toString()}`;
                logger.debug('Making Nominatim API request', { url });

                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': constants.HTTP_USER_AGENT,
                        'Accept-Language': 'es'
                    }
                });
                const { address } = response.data;

                const locationDetails = {
                    distrito: address.quarter || '',
                    barrio: address.suburb || '',
                    direccion: address.road || '',
                    ciudad: address.city || ''
                };

                // Actualizar en la base de datos
                const result = await this.collection.updateOne(
                    { id: request.eventId },
                    {
                        $set: {
                            distrito: locationDetails.distrito,
                            barrio: locationDetails.barrio,
                            streetAddress: locationDetails.direccion,
                            locality: locationDetails.ciudad,
                            locationLastUpdated: new Date()
                        }
                    }
                );

                logger.debug('Location details updated in database', {
                    eventId: request.eventId,
                    success: result.modifiedCount > 0,
                    details: locationDetails
                });

            } catch (error) {
                const status = error.response?.status;
                const aggregateErrors = error instanceof AggregateError ? error.errors : undefined;
                
                // Handle connection refused specifically (Circuit Breaker)
                if (error.code === 'ECONNREFUSED') {
                    const blockDurationMs = 5 * 60 * 1000; // 5 minutes
                    this.blockedUntil = new Date(Date.now() + blockDurationMs);
                    
                    logger.warn('Connection refused by Nominatim service. Blocking requests for 5 minutes.', {
                        eventId: request.eventId,
                        blockedUntil: this.blockedUntil
                    });
                    
                    // Re-enqueue the current request so it's not lost
                    this.queue.unshift(request);
                    
                    // Wait a bit to avoid tight loop if something is weird
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                logger.error('Error processing location request', {
                    eventId: request.eventId,
                    error: error.message,
                    code: error.code,
                    status,
                    aggregateErrors: aggregateErrors?.map(err => ({
                        message: err?.message,
                        code: err?.code
                    })),
                    stack: error.stack
                });

                if (status === 429) {
                    delayMs = constants.QUEUE_REQUEST_DELAY_MS * 4;
                }

                const retriableStatus = status >= 500 || status === 429;
                const retriableNetworkError = !error.response;
                if ((retriableStatus || retriableNetworkError) && request.retries < constants.MAX_QUEUE_RETRIES) {
                    request.retries += 1;
                    logger.info('Re-enqueueing failed request due to transient error', {
                        eventId: request.eventId,
                        retries: request.retries
                    });
                    this.queue.push(request);
                } else if (request.retries >= constants.MAX_QUEUE_RETRIES) {
                    logger.warn('Dropping request after max retries', { eventId: request.eventId });
                }
            }

            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    getQueueSize() {
        return this.queue.length;
    }

    // Método para limpiar la cola (útil para tests o mantenimiento)
    clearQueue() {
        const size = this.queue.length;
        this.queue = [];
        logger.info('Queue cleared', { previousSize: size });
    }
}

module.exports = LocationQueue;
