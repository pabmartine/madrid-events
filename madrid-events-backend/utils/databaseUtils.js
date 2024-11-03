const logger = require('../config/logger');
const { EventDomainService } = require('../domain');

class DatabaseUtils {
    static async deletePastEvents(database, collectionName) {
        try {
            const collection = database.collection(collectionName);
            const currentDate = new Date().toISOString();

            const result = await collection.deleteMany({
                dtend: {
                    $lt: currentDate
                }
            });

            logger.info(`Deleted past events`, {
                count: result.deletedCount
            });
        } catch (error) {
            logger.error('Error deleting past events:', error.message);
        }
    }

    static async getExistingEventData(collection, eventId, constants) {
        try {
            const existingEvent = await collection.findOne({ id: eventId });

            if (!existingEvent) {
                logger.debug(`No existing data found for event ${eventId}`);
                return {
                    locationDetails: {
                        distrito: '',
                        barrio: '',
                        direccion: '',
                        ciudad: ''
                    },
                    nearestSubway: null,
                    imageUrl: null,
                    subwayLines: []
                };
            }

            logger.debug(`Found existing data for event ${eventId}`);
            const event = EventDomainService.fromJSON(existingEvent);
            const imageUrl = event.image === constants.IMAGE_NOT_FOUND ? null : event.image;

            return {
                locationDetails: {
                    distrito: event.distrito || '',
                    barrio: event.barrio || '',
                    direccion: event.streetAddress || '',
                    ciudad: event.locality || ''
                },
                nearestSubway: event.subway || null,
                imageUrl: event.image || null,
                subwayLines: event.subwayLines || []
            };
        } catch (error) {
            logger.error(`Error getting existing data for event ${eventId}:`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
}

module.exports = DatabaseUtils;