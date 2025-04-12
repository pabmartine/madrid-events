class StringUtils {
static stripInvalidControlCharacters(str) {
    // Remove control characters (0-31 and 127 in decimal)
    let cleanedStr = str.replace(/[\x00-\x1F\x7F]/g, '');
    // Handle backslashes:
    cleanedStr = cleanedStr.replace(/\\(.)/g, (match, p1) => {
        if (['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'].includes(p1)) {
            return '\\' + p1;  // Keep valid escapes
        }
        return p1; // Remove or keep the character (decide based on your needs)
    });
    return cleanedStr;
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