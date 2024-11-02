const logger = require('../utils/logger');
const axios = require('../utils/axios');
const constants = require('../config/constants');

class SubwayQueue {
    constructor(db) {
        if (!db) {
            throw new Error('Database connection is required for SubwayQueue');
        }
        this.queue = [];
        this.isProcessing = false;
        this.shouldStop = false;
        this.db = db;
        this.collection = db.collection(constants.COLLECTION_NAME);

        // Iniciar el procesamiento
        this.startProcessing();
        logger.info('SubwayQueue initialized');
    }

    /**
     * Obtiene la estación de metro más cercana para unas coordenadas dadas
     * Si no está en la base de datos, encola la petición y devuelve null
     */
    async getNearestSubway(latitude, longitude, eventId) {
        try {
            if (!eventId) {
                logger.error('No eventId provided for subway search');
                return null;
            }

            // Verificar si ya tenemos los datos en la base de datos
            const existingEvent = await this.collection.findOne({ id: eventId });

            // Si ya tenemos la información de metro y es válida, la devolvemos
            if (existingEvent && existingEvent.subway !== undefined) {
                logger.debug('Returning existing subway data', {
                    eventId,
                    subway: existingEvent.subway
                });
                return existingEvent.subway;
            }

            // Si no tenemos datos, encolamos la petición
            await this.enqueue(latitude, longitude, eventId);
            logger.debug('Subway request enqueued for missing data', {
                eventId,
                queueSize: this.queue.length
            });

            // Devolvemos null ya que no tenemos datos todavía
            return null;

        } catch (error) {
            logger.error('Error in getNearestSubway:', {
                error: error.message,
                stack: error.stack,
                eventId,
                latitude,
                longitude
            });

            return null;
        }
    }

    async enqueue(latitude, longitude, eventId) {
        logger.debug('Enqueueing subway request', {
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
            logger.info('Stopping subway queue processing...');
            this.shouldStop = true;
        }

    async processQueue() {
        while (!this.shouldStop) {
            if (this.queue.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar 5 segundos y revisar de nuevo
                continue;
            }

            const request = this.queue.shift();
            logger.info('Processing subway request from queue', {
                eventId: request.eventId,
                queueLength: this.queue.length
            });

            try {
                const overpassUrl = `${constants.OVERPASS_API_BASE}?data=[out:json];node(around:1000,${request.latitude},${request.longitude})[railway=station][operator="Metro de Madrid"];out;`;
                logger.debug('Making Overpass API request', { url: overpassUrl });

                const response = await axios.get(overpassUrl);
                const elements = response.data.elements;

                let subwayStation = null;
                if (elements && elements.length > 0) {
                    const station = elements.find(element => element.tags && element.tags.name);
                    subwayStation = station ? station.tags.name : null;
                }

                // Actualizar en la base de datos
                const result = await this.collection.updateOne(
                    { id: request.eventId },
                    {
                        $set: {
                            subway: subwayStation || '',
                            subwayLastUpdated: new Date()
                        }
                    }
                );

                logger.debug('Subway data updated in database', {
                    eventId: request.eventId,
                    success: result.modifiedCount > 0,
                    subway: subwayStation
                });

            } catch (error) {
                logger.error('Error processing subway request', {
                    eventId: request.eventId,
                    error: error.message,
                    stack: error.stack
                });

                // Si es un error temporal, volvemos a encolar la petición
                if (error.response && error.response.status >= 500) {
                    logger.info('Re-enqueueing failed subway request due to server error', {
                        eventId: request.eventId
                    });
                    this.queue.push(request);
                }
            }

            // Esperar 30 segundos antes de la siguiente petición
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    getQueueSize() {
        return this.queue.length;
    }

    clearQueue() {
        const size = this.queue.length;
        this.queue = [];
        logger.info('Subway queue cleared', { previousSize: size });
    }
}

module.exports = SubwayQueue;