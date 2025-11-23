const sanitizeHtml = require('sanitize-html');

const defaultHtmlOptions = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ['src', 'alt']
    },
    disallowedTagsMode: 'discard'
};

class SanitizeUtils {
    static sanitizeHtmlContent(content = '') {
        return sanitizeHtml(content || '', defaultHtmlOptions);
    }

    static sanitizeTextContent(content = '') {
        if (!content) {
            return '';
        }
        return sanitizeHtml(content, {
            allowedTags: [],
            allowedAttributes: {}
        });
    }

    static sanitizeEvent(event) {
        if (!event) {
            return event;
        }

        event.title = this.sanitizeTextContent(event.title);
        event.description = this.sanitizeHtmlContent(event.description);
        event.eventLocation = this.sanitizeTextContent(event.eventLocation);
        event.organizationName = this.sanitizeTextContent(event.organizationName);
        event.streetAddress = this.sanitizeTextContent(event.streetAddress);
        event.locality = this.sanitizeTextContent(event.locality);

        return event;
    }
}

module.exports = SanitizeUtils;
