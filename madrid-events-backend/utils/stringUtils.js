class StringUtils {
    static stripInvalidControlCharacters(str) {
        return str.replace(/[\x00-\x1F\x7F]/g, '');
    }

    static normalizeString(str) {
        return str.toLowerCase();
    }

    static cleanOrganizationName(orgName, distrito, barrio) {
        const regex = /\(([^)]+)\)/g;
        return orgName.replace(regex, (match, p1) => {
            const normalizedP1 = p1.trim().toLowerCase();
            if (normalizedP1 === distrito.toLowerCase() || normalizedP1 === barrio.toLowerCase()) {
                return '';
            }
            return match;
        }).trim();
    }
}

module.exports = StringUtils;