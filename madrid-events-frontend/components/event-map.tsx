import dynamic from 'next/dynamic';
// Dynamically imported react-leaflet components
const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then(mod => mod.Popup), { ssr: false });
import React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useIntl } from 'react-intl'
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
import { Event } from '../types/types'
import MapController from './map-controller'

const DefaultIcon = L.icon({
  iconUrl: icon.src,
  shadowUrl: iconShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
})

L.Marker.prototype.options.icon = DefaultIcon

interface ColorPalette {
  cardBg: string
  titleText: string
  text: string
  priceBadgeBg: string
  priceBadgeText: string
}

interface EventMapProps {
  events: Event[]
  colorPalette: ColorPalette
  onEventSelect: (event: Event) => void
  shouldResetView: boolean
  onResetViewComplete: () => void
}

const EventMap: React.FC<EventMapProps> = ({ 
  events, 
  colorPalette, 
  onEventSelect, 
  shouldResetView, 
  onResetViewComplete 
}) => {
  const intl = useIntl()
  
  const handleEventSelect = (event: Event) => {
    onEventSelect(event)
  }

  const truncatePrice = (price: string) => {
    return price.length > 30 ? price.substring(0, 27) + '...' : price
  }

  return (
    <div className="relative w-full h-full" style={{ zIndex: 1 }}>
      <MapContainer
        center={[40.4168, -3.7038]}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
      >
        <MapController events={events} shouldResetView={shouldResetView} onResetViewComplete={onResetViewComplete}/>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {events.map((event) => (
          event.latitude && event.longitude && (
            <Marker
              key={event.id}
              position={[event.latitude, event.longitude]}
            >
              <Popup>
                <div 
                  className={`${colorPalette.cardBg} p-2 rounded w-64 cursor-pointer`}
                  onClick={() => handleEventSelect(event)}
                >
                  {event.image && (
                    <img src={event.image} alt={event.title} className="w-full h-32 object-cover mb-2 rounded" />
                  )}
                  <h3 className={`${colorPalette.titleText} font-bold text-lg mb-1`}>{event.title}</h3>
                  <p className={`${colorPalette.text} text-sm mb-1`}>{event["event-location"]}</p>
                  <div className={`${colorPalette.text} text-sm flex items-center mb-1`}>
                    <span>{new Date(event.dtstart).toLocaleDateString()}</span>
                    {event.time && (
                      <>
                        <span className="mx-1">•</span>
                        <span>{event.time}</span>
                      </>
                    )}
                  </div>
                  <span className={`${colorPalette.priceBadgeBg} ${colorPalette.priceBadgeText} px-2 py-1 rounded-full text-sm font-bold`}>
                    {event.free ? intl.formatMessage({ id: 'app.event.free' }) : truncatePrice(intl.formatMessage({ id: 'app.event.from' }, { price: event.price || '20€' }))}
                  </span>
                </div>
              </Popup>
            </Marker>
          )
        ))}
      </MapContainer>
      {events.filter(e => e.latitude && e.longitude).length === 0 && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-4 rounded shadow-md z-[1000]">
          <p className="text-gray-800">{intl.formatMessage({ id: 'app.map.no.events' })}</p>
        </div>
      )}
    </div>
  )
}

export default EventMap