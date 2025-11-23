class ValidationUtils {
    static parseBoolean(value, defaultValue = false) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            const normalized = value.toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
        }
        return defaultValue;
    }

    static parseInteger(value, options = {}) {
        const { min = 0, max = Number.MAX_SAFE_INTEGER, defaultValue = 0 } = options;
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed)) {
            return defaultValue;
        }
        return Math.min(Math.max(parsed, min), max);
    }

    static parseDate(value) {
        if (!value) {
            return null;
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
}

module.exports = ValidationUtils;
