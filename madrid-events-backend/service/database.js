const { MongoClient } = require('mongodb');
const constants = require('../config/constants');
const logger = require('../config/logger');

let db;
let mongoClient;

async function createIndexes(dbInstance) {
    if (!dbInstance) {
        logger.error('Database instance is not available for creating indexes.');
        return;
    }
    try {
        const collection = dbInstance.collection(constants.COLLECTION_NAME);
        await collection.createIndex(
            {
                title: 'text',
                description: 'text',
                distrito: 'text',
                barrio: 'text',
                'event-location': 'text',
                'organization-name': 'text'
            },
            {
                name: 'events_text_search_index',
                default_language: 'spanish'
            }
        );
        logger.info('Text search index ensured on events collection.');

        await collection.createIndex({ dtstart: 1 }, { name: 'events_dtstart_index' });
        await collection.createIndex({ dtend: 1 }, { name: 'events_dtend_index' });
        await collection.createIndex({ distrito: 1 }, { name: 'events_distrito_index' });
        await collection.createIndex({ barrio: 1 }, { name: 'events_barrio_index' });
        await collection.createIndex({ free: 1 }, { name: 'events_free_index' });
        await collection.createIndex({ audience: 1 }, { name: 'events_audience_index' });
        logger.info('Basic filter indexes ensured on events collection.');
    } catch (error) {
        if (error.codeName === 'IndexOptionsConflict' || error.code === 85) {
            logger.info('Text search index already exists.');
        } else {
            logger.error('Error creating text search index:', error.message);
        }
    }
}

async function connectToMongoDB() {
    try {
        const client = await MongoClient.connect(constants.MONGO_URI, {});
        mongoClient = client;
        db = client.db(constants.DB_NAME);
        logger.info('Connected to MongoDB');

        await createIndexes(db);

        return client;
    } catch (error) {
        logger.error('Error connecting to MongoDB:', error.message);
        process.exit(1);
    }
}

async function getDb() {
    if (!db) {
        await connectToMongoDB();
    }
    return db;
}

async function closeConnection() {
    if (mongoClient) {
        try {
            await mongoClient.close();
            logger.info('MongoDB connection closed');
            db = null;
            mongoClient = null;
        } catch (error) {
            logger.error('Error closing MongoDB connection:', error.message);
            throw error;
        }
    }
}

process.on('SIGINT', async () => {
    logger.info('Shutting down database connection');
    try {
        await closeConnection();
        process.exit(0);
    } catch (error) {
        logger.error('Error during database shutdown', error);
        process.exit(1);
    }
});

module.exports = {
    connectToMongoDB,
    getDb,
    closeConnection
};
