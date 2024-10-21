import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { Event } from '../types/types'

interface MapControllerProps {
  events: Event[]
  shouldResetView: boolean
  onResetViewComplete: () => void
}

const MapController: React.FC<MapControllerProps> = ({ events, shouldResetView, onResetViewComplete }) => {
  const map = useMap()
  const eventsRef = useRef(events)

  useEffect(() => {
    if (shouldResetView || JSON.stringify(eventsRef.current) !== JSON.stringify(events)) {
      const eventsWithCoordinates = events.filter(e => e.latitude && e.longitude)
      if (eventsWithCoordinates.length > 0) {
        const bounds = L.latLngBounds(eventsWithCoordinates.map(e => [e.latitude, e.longitude]))
        map.fitBounds(bounds)
      } else {
        map.setView([40.4168, -3.7038], 12)
      }
      onResetViewComplete()
      eventsRef.current = events
    }
  }, [events, map, shouldResetView, onResetViewComplete])

  return null
}

export default MapController