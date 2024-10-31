class Event {
    constructor({
        id,
        title,
        description,
        free,
        price,
        dtstart,
        dtend,
        time,
        audience,
        eventLocation,
        locality,
        postalCode,
        streetAddress,
        latitude,
        longitude,
        organizationName,
        link,
        image,
        distrito,
        barrio,
        distance,
        subway,
        subwayLines,
        excludedDays
    }) {
        this.id = id || '';
        this.title = title || '';
        this.description = description || '';
        this.free = free || false;
        this.price = price || '';
        this.dtstart = dtstart || '';
        this.dtend = dtend || '';
        this.time = time || '';
        this.audience = Array.isArray(audience) ? audience : [audience || ''];
        this.eventLocation = eventLocation || '';
        this.locality = locality || '';
        this.postalCode = postalCode || '';
        this.streetAddress = streetAddress || '';
        this.latitude = latitude || null;
        this.longitude = longitude || null;
        this.organizationName = organizationName || '';
        this.link = link || '';
        this.image = image || null;
        this.distrito = distrito || '';
        this.barrio = barrio || '';
        this.distance = distance || null;
        this.subway = subway || '';
        this.subwayLines = subwayLines || [];
        this.excludedDays = excludedDays || '';
    }

    toJSON() {
        return {
            id: this.id,
            title: this.title,
            description: this.description,
            free: this.free,
            price: this.price,
            dtstart: this.dtstart,
            dtend: this.dtend,
            time: this.time,
            audience: this.audience,
            'event-location': this.eventLocation,
            locality: this.locality,
            'postal-code': this.postalCode,
            'street-address': this.streetAddress,
            latitude: this.latitude,
            longitude: this.longitude,
            'organization-name': this.organizationName,
            link: this.link,
            image: this.image,
            distrito: this.distrito,
            barrio: this.barrio,
            distance: this.distance,
            subway: this.subway,
            subwayLines: this.subwayLines,
            'excluded-days': this.excludedDays
        };
    }
}

module.exports = Event;
