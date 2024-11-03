class CoordinateUtils {
    static validateCoordinates(lat, lon) {
        return !(!lat || !lon || isNaN(lat) || isNaN(lon));
    }
}

module.exports = CoordinateUtils;