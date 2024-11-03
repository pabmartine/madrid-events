const { MongoClient } = require('mongodb');
const constants = require('../config/constants');
const logger = require('../config/logger');

let db;

async function connectToMongoDB() {
    try {
        const client = await MongoClient.connect(constants.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        db = client.db(constants.DB_NAME);
        logger.info('Connected to MongoDB');
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
    if (db) {
        try {
            await db.client.close();
            logger.info('MongoDB connection closed');
            db = null;
        } catch (error) {
            logger.error('Error closing MongoDB connection:', error.message);
            throw error;
        }
    }
}

// Manejo básico de errores de conexión
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