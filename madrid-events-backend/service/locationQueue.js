const logger = require('../utils/logger');
const axios = require('../utils/axios');
const constants = require('../config/constants');

class LocationQueue {
    constructor(db) {
        if (!db) {
            throw new Error('Database connection is required for LocationQueue');
        }
        this.queue = [];
        this.isProcessing = false;
        this.shouldStop = false;
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
                existingEvent.distrito &&
                existingEvent.barrio &&
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
                timestamp: new Date()
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
                await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar 5 segundos y revisar de nuevo
                continue;
            }

            const request = this.queue.shift();
            logger.info('Processing location request from queue', {
                eventId: request.eventId,
                queueLength: this.queue.length
            });

            try {
                const url = `${constants.NOMINATIM_API_BASE}?lat=${request.latitude}&lon=${request.longitude}&format=json`;
                logger.debug('Making Nominatim API request', { url });

                const response = await axios.get(url);
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
                logger.error('Error processing location request', {
                    eventId: request.eventId,
                    error: error.message,
                    stack: error.stack
                });

                // Si es un error temporal, volvemos a encolar la petición
                if (error.response && error.response.status >= 500) {
                    logger.info('Re-enqueueing failed request due to server error', {
                        eventId: request.eventId
                    });
                    this.queue.push(request);
                }
            }

            // Esperar 30 segundos antes de la siguiente petición
            await new Promise(resolve => setTimeout(resolve, 30000));
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