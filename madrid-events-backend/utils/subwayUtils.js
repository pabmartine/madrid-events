const logger = require('../config/logger');
const StringUtils = require('./stringUtils');

class SubwayUtils {
    static async getSubwayLines(stationName, subwayData) {
        try {
            if (!subwayData) {
                logger.error('Subway data not initialized');
                return [];
            }

            const normalizedStationName = StringUtils.normalizeString(stationName);

            logger.debug('Searching for subway lines', {
                station: stationName,
                normalizedName: normalizedStationName
            });

            const stationData = subwayData.find(station =>
                StringUtils.normalizeString(station.subway) === normalizedStationName
            );

            if (stationData) {
                logger.debug('Found subway lines', {
                    station: stationName,
                    lines: stationData.lines
                });
                return stationData.lines;
            }

            logger.debug('No subway lines found for station', {
                station: stationName
            });
            return [];
        } catch (error) {
            logger.error('Error getting subway lines:', {
                error: error.message,
                station: stationName
            });
            return [];
        }
    }
}

module.exports = SubwayUtils;