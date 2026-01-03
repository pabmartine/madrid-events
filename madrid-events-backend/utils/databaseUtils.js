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

    static async recalculateDistances(database, collectionName, baseLat, baseLon) {
        try {
            const collection = database.collection(collectionName);
            const cursor = collection.find({});
            const bulkOps = [];
            let processed = 0;
            let updated = 0;

            for await (const doc of cursor) {
                const latValue = doc.latitude ?? doc.location?.latitude ?? null;
                const lonValue = doc.longitude ?? doc.location?.longitude ?? null;
                const lat = typeof latValue === 'number' ? latValue : Number(latValue);
                const lon = typeof lonValue === 'number' ? lonValue : Number(lonValue);
                const event = { latitude: lat, longitude: lon };
                const newDistance = EventDomainService.hasValidCoordinates(event)
                    ? EventDomainService.calculateDistance(event, baseLat, baseLon)
                    : null;

                if (doc.distance !== newDistance) {
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: doc._id },
                            update: { $set: { distance: newDistance } }
                        }
                    });
                    updated += 1;
                }

                if (bulkOps.length >= 500) {
                    await collection.bulkWrite(bulkOps, { ordered: false });
                    bulkOps.length = 0;
                }

                processed += 1;
            }

            if (bulkOps.length > 0) {
                await collection.bulkWrite(bulkOps, { ordered: false });
            }

            logger.info('Recalculated distances', {
                processed,
                updated,
                baseLat,
                baseLon
            });
        } catch (error) {
            logger.error('Error recalculating distances:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
}

module.exports = DatabaseUtils;
