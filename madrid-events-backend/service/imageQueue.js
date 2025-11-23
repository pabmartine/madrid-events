const logger = require('../config/logger');
const axios = require('../config/axios');
const cheerio = require('cheerio');
const constants = require('../config/constants');

class ImageQueue {
    constructor(db) {
        if (!db) {
            throw new Error('Database connection is required for ImageQueue');
        }
        this.queue = [];
        this.isProcessing = false;
        this.shouldStop = false;
        this.db = db;
        this.collection = db.collection(constants.COLLECTION_NAME);

        this.startProcessing();
        logger.info('ImageQueue initialized');
    }

    stopProcessing() {
        logger.info('Stopping image queue processing...');
        this.shouldStop = true;
    }

    async getImageUrl(eventId, link) {
        try {
            if (!eventId || !link) {
                logger.error('Missing required parameters for image fetch', {
                    eventId,
                    hasLink: !!link
                });
                return null;
            }

            // Verificar si ya tenemos los datos en la base de datos
            const existingEvent = await this.collection.findOne({ id: eventId });

            // Si ya tenemos la imagen, la devolvemos
            if (existingEvent && existingEvent.image) {
                logger.debug('Returning existing image data', {
                    eventId,
                    image: existingEvent.image
                });
                return existingEvent.image;
            }

            // Si no tenemos imagen, encolamos la petición
            await this.enqueue(eventId, link);
            logger.debug('Image request enqueued', {
                eventId,
                link,
                queueSize: this.queue.length
            });

            return null;

        } catch (error) {
            logger.error('Error in getImageUrl:', {
                error: error.message,
                stack: error.stack,
                eventId,
                link
            });

            return null;
        }
    }

    async enqueue(eventId, link) {
        if (this.queue.length >= constants.MAX_QUEUE_LENGTH) {
            const dropped = this.queue.shift();
            logger.warn('Image queue reached max length, dropping oldest request', {
                droppedEventId: dropped?.eventId
            });
        }

        // Verificar si ya existe en la cola
        const existingRequest = this.queue.find(req =>
            req.eventId === eventId &&
            req.link === link
        );

        if (!existingRequest) {
            this.queue.push({
                eventId,
                link,
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

    async processQueue() {
        while (!this.shouldStop) {
            if (this.queue.length === 0) {
                await new Promise(resolve => setTimeout(resolve, constants.QUEUE_REQUEST_DELAY_MS));
                continue;
            }

            const request = this.queue.shift();
            logger.debug('Processing image request from queue', {
                eventId: request.eventId,
                link: request.link,
                queueLength: this.queue.length
            });

            try {
                const response = await axios.get(request.link);
                const $ = cheerio.load(response.data);
                const imageElement = $('.image-content img');

                let imageUrl = null;

                if (imageElement.length) {
                    imageUrl = imageElement.attr('src');
                    if (imageUrl && !imageUrl.startsWith('http')) {
                        imageUrl = `https://www.madrid.es${imageUrl}`;
                    }
                }

                const finalImageUrl = imageUrl || constants.IMAGE_NOT_FOUND;

                // Actualizar en la base de datos
                const result = await this.collection.updateOne(
                    { id: request.eventId },
                    {
                        $set: {
                            image: finalImageUrl,
                            imageLastUpdated: new Date()
                        }
                    }
                );

                logger.debug('Image data updated in database', {
                    eventId: request.eventId,
                    success: result.modifiedCount > 0,
                    imageUrl: finalImageUrl
                });

            } catch (error) {
                logger.error('Error processing image request', {
                    eventId: request.eventId,
                    error: error.message,
                    stack: error.stack
                });

                const retriableStatus = error.response && error.response.status >= 500;
                const retriableNetworkError = !error.response;
                if ((retriableStatus || retriableNetworkError) && request.retries < constants.MAX_QUEUE_RETRIES) {
                    request.retries += 1;
                    logger.info('Re-enqueueing failed image request due to transient error', {
                        eventId: request.eventId,
                        retries: request.retries
                    });
                    this.queue.push(request);
                } else if (request.retries >= constants.MAX_QUEUE_RETRIES) {
                    logger.warn('Dropping image request after max retries', { eventId: request.eventId });
                }
            }

            await new Promise(resolve => setTimeout(resolve, constants.QUEUE_REQUEST_DELAY_MS));
        }
        logger.info('Image queue processing stopped');
    }

    getQueueSize() {
        return this.queue.length;
    }

    clearQueue() {
        const size = this.queue.length;
        this.queue = [];
        logger.info('Image queue cleared', { previousSize: size });
    }
}

module.exports = ImageQueue;
