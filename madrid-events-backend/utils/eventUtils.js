const logger = require('../config/logger');

class EventUtils {
    static isEventWithinValidDateRange(event, days = 30) {
        const currentDate = new Date();
        const eventStart = new Date(event.dtstart);
        const eventEnd = new Date(event.dtend);
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + days);

        const isNotPastEvent = eventEnd >= currentDate;
        const isWithinFutureLimit = eventStart <= maxDate;

        if (!isNotPastEvent) {
            logger.debug(`Event ${event.id} has already ended`, {
                title: event.title,
                endDate: event.dtend,
                currentDate: currentDate.toISOString()
            });
        }

        if (!isWithinFutureLimit) {
            logger.debug(`Event ${event.id} starts more than ${days} days in the future`, {
                title: event.title,
                startDate: event.dtstart,
                maxDate: maxDate.toISOString()
            });
        }

        return isNotPastEvent && isWithinFutureLimit;
    }
}

module.exports = EventUtils;