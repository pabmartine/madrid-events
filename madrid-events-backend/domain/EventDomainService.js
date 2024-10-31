const Event = require('./Event');

class EventDomainService {
    static fromJSON(json) {
        return new Event({
            id: json.id,
            title: json.title,
            description: json.description,
            free: json.free,
            price: json.price,
            dtstart: json.dtstart,
            dtend: json.dtend,
            time: json.time,
            audience: json.audience,
            eventLocation: json['event-location'],
            locality: json.locality,
            postalCode: json['postal-code'],
            streetAddress: json['street-address'],
            latitude: json.latitude,
            longitude: json.longitude,
            organizationName: json['organization-name'],
            link: json.link,
            image: json.image,
            distrito: json.distrito,
            barrio: json.barrio,
            distance: json.distance,
            subway: json.subway,
            subwayLines: json.subwayLines,
            excludedDays: json['excluded-days']
        });
    }

    static fromXMLData(xmlEvent) {
        const event = new Event({
            id: `xml-${xmlEvent.$.id}`,
            title: this.cleanCDATA(xmlEvent.basicData[0].title[0]),
            description: this.cleanCDATA(xmlEvent.basicData[0].body[0]),
            eventLocation: xmlEvent.geoData[0].address[0],
            locality: xmlEvent.geoData[0].locality[0] || '',
            postalCode: xmlEvent.geoData[0].zipcode[0],
            streetAddress: xmlEvent.geoData[0].address[0],
            latitude: parseFloat(xmlEvent.geoData[0].latitude[0]),
            longitude: parseFloat(xmlEvent.geoData[0].longitude[0]),
            link: xmlEvent.basicData[0].web[0]
        });

        if (xmlEvent.extradata && xmlEvent.extradata[0]) {
            this.processExtraData(event, xmlEvent.extradata[0]);
        }

        if (xmlEvent.multimedia && xmlEvent.multimedia[0]) {
            this.processMultimedia(event, xmlEvent.multimedia[0]);
        }

        return event;
    }

    static isActive(event) {
        const currentDate = new Date();
        const endDate = new Date(event.dtend);
        return endDate >= currentDate;
    }

    static isFree(event) {
        if (event.free) return true;
        const lowercasePrice = event.price.toLowerCase();
        return lowercasePrice.includes('gratis') || lowercasePrice.includes('gratuit');
    }

    static hasValidCoordinates(event) {
        return event.latitude !== null &&
               event.longitude !== null &&
               !isNaN(event.latitude) &&
               !isNaN(event.longitude);
    }

    static calculateDistance(event, baseLat, baseLon) {
        if (!this.hasValidCoordinates(event)) return null;

        const R = 6371; // Radio de la Tierra en km
        const dLat = this.deg2rad(event.latitude - baseLat);
        const dLon = this.deg2rad(event.longitude - baseLon);
        const a =
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.deg2rad(baseLat)) * Math.cos(this.deg2rad(event.latitude)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Métodos privados de ayuda
    static deg2rad(deg) {
        return deg * (Math.PI/180);
    }

    static cleanCDATA(text) {
        return text.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
    }

    static processExtraData(event, extradata) {
        if (extradata.categorias && extradata.categorias[0].categoria) {
            this.processCategories(event, extradata.categorias[0].categoria[0]);
        }

        if (extradata.item) {
            this.processExtraItems(event, extradata.item);
        }

        if (extradata.fechas && extradata.fechas[0].rango) {
            this.processDates(event, extradata.fechas[0].rango[0]);
        }
    }

    static processCategories(event, categoria) {
        if (categoria.item) {
            const categoriaItem = categoria.item.find(item =>
                item.$ && item.$.name === 'Categoria');
            if (categoriaItem && categoriaItem._) {
                event.audience.push(categoriaItem._);
            }
        }

        if (categoria.subcategorias && categoria.subcategorias[0].subcategoria) {
            categoria.subcategorias[0].subcategoria.forEach(subcategoria => {
                if (subcategoria.item) {
                    const subcategoriaItem = subcategoria.item.find(item =>
                        item.$ && item.$.name === 'SubCategoria');
                    if (subcategoriaItem && subcategoriaItem._) {
                        event.audience.push(subcategoriaItem._);
                    }
                }
            });
        }
    }

    static processExtraItems(event, items) {
        items.forEach(item => {
            if (item.$ && item.$.name === 'Servicios de pago' && item._) {
                this.processPrice(event, item._);
            } else if (item.$ && item.$.name === 'Horario' && item._) {
                event.time = this.cleanCDATA(item._);
            }
        });
    }

    static processPrice(event, priceText) {
        const cleanPrice = this.cleanCDATA(priceText);
        event.price = cleanPrice;
        event.free = cleanPrice.toLowerCase().includes('gratuito') ||
                     cleanPrice.toLowerCase().includes('gratis');
    }

    static processDates(event, rango) {
        if (rango.inicio && rango.fin) {
            event.dtstart = this.convertDateFormat(rango.inicio[0]);
            event.dtend = this.convertDateFormat(rango.fin[0]);
        }
    }

    static convertDateFormat(dateStr) {
        const [day, month, year] = dateStr.split('/');
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`;
    }

    static processMultimedia(event, multimedia) {
        if (multimedia.media) {
            const imageMedia = multimedia.media.find(media =>
                media.$?.type?.toLowerCase() === 'image' && media.url?.[0]
            );

            if (imageMedia) {
                event.image = imageMedia.url[0];
            }
        }
    }
}

module.exports = EventDomainService;
