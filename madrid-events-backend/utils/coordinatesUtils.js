class CoordinateUtils {
    static validateCoordinates(lat, lon) {
        if (lat === '' || lon === '') {
            return false;
        }
        const latValue = Number(lat);
        const lonValue = Number(lon);
        return Number.isFinite(latValue) && Number.isFinite(lonValue);
    }
}

module.exports = CoordinateUtils;
