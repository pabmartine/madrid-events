'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { X, MapPin, Euro, Calendar, Clock, Ruler, Train, RailSymbol } from 'lucide-react'
import { useIntl } from 'react-intl'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { Event } from '../types/types'

interface ColorPalette {
  cardBg: string
  titleText: string
  subtitleText: string
  text: string
  priceBadgeBg: string
  priceBadgeText: string
  buttonBg: string
  buttonText: string
  buttonHover: string
  buttonBorder: string
}

interface EventModalProps {
  event: Event
  onClose: () => void
  colorPalette: ColorPalette
}

export default function EventModal({ event, onClose, colorPalette }: EventModalProps) {
  const intl = useIntl()
  const [isVisible, setIsVisible] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsVisible(true)
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [])

  const handleClose = () => {
    setIsVisible(false)
    setTimeout(onClose, 300)
  }

  const handleOutsideClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      handleClose()
    }
  }

  const formatDate = (start: string, end: string) => {
    const startDate = new Date(start).toLocaleDateString()
    const endDate = end ? new Date(end).toLocaleDateString() : null
    return endDate ? `${startDate} - ${endDate}` : startDate
  }

  const renderInfoItem = (Icon: React.ElementType, content: React.ReactNode, extraContent: React.ReactNode = null) => {
    if (!content && !extraContent) return null
    return (
      <div className="flex items-center">
        <Icon className={`w-5 h-5 mr-2 flex-shrink-0 ${colorPalette.titleText}`} />
        <span className={`${colorPalette.text} flex items-center`}>
          {content}
          {extraContent && (
            <span className="ml-2 flex-shrink-0">
              {extraContent}
            </span>
          )}
        </span>
      </div>
    )
  }

  const renderAddress = () => {
    const address = [
      event["street-address"],
      event.locality,
      event["postal-code"]
    ].filter(Boolean).join(", ")

    return address ? renderInfoItem(MapPin, address) : null
  }

  const renderMetroLines = () => {
    if (!event.subwayLines || event.subwayLines.length === 0) return null
    const metroLines = (
      <span className="flex flex-wrap items-center">
        {event.subwayLines.map((line, index) => (
          <span
            key={index}
            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold ml-1"
            style={{ backgroundColor: line.color }}
            aria-label={intl.formatMessage({ id: 'app.event.subway.line' }, { number: line.number })}
          >
            {line.number}
          </span>
        ))}
      </span>
    )
    return renderInfoItem(RailSymbol, intl.formatMessage({ id: 'app.event.subway.lines' }), metroLines)
  }

  return (
    <div 
      className="fixed inset-0 z-[9999] overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center"
      onClick={handleOutsideClick}
    >
      <div 
        ref={modalRef}
        className={`relative w-full max-w-2xl mx-4 my-8 ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} transition-all duration-300 ease-out`}
      >
        <div className={`${colorPalette.cardBg} rounded-lg overflow-hidden shadow-xl max-h-[90vh] overflow-y-auto scrollbar-hide`}>
          <div className="relative h-64">
            {event.image ? (
              <Image src={event.image} alt={event.title} layout="fill" objectFit="cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-500">
                {intl.formatMessage({ id: 'app.event.image.unavailable' })}
              </div>
            )}
            <button
              onClick={handleClose}
              className={`absolute top-2 right-2 ${colorPalette.cardBg} rounded-full p-2 transition-all duration-200 ease-out hover:bg-opacity-80`}
              aria-label={intl.formatMessage({ id: 'app.event.close' })}
            >
              <X size={24} />
            </button>
          </div>
          <div className="p-6">
            <h2 id="modal-title" className={`text-2xl font-bold mb-2 ${colorPalette.text}`}>{event.title}</h2>
            <h3 className={`text-lg mb-4 ${colorPalette.subtitleText}`}>{event["event-location"]}</h3>
            <p className={`${colorPalette.text} mb-4`}>{event.description}</p>
         
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {renderAddress()}
              {renderInfoItem(Euro, event.free && event.price === "" ? intl.formatMessage({ id: 'app.event.free' }) : (event.price || intl.formatMessage({ id: 'app.event.free' })))}
              {renderInfoItem(Calendar, formatDate(event.dtstart, event.dtend))}
              {renderInfoItem(Clock, event.time)}
              {renderInfoItem(Ruler, event.distance ? intl.formatMessage({ id: 'app.event.distance' }, { distance: event.distance.toFixed(2) }) : null)}
              {renderInfoItem(Train, event.subway ? intl.formatMessage({ id: 'app.event.subway' }, { subway: event.subway }) : null)}
              {renderMetroLines()}
            </div>
            {event.latitude && event.longitude && (
              <div className="mb-4">
                <h3 className={`font-semibold mb-2 ${colorPalette.text}`}>
                  {intl.formatMessage({ id: 'app.event.location' })}:
                </h3>
                <div className="h-64">
                  <MapContainer center={[event.latitude, event.longitude]} zoom={17} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <Marker position={[event.latitude, event.longitude]}>
                      <Popup>{event.title}</Popup>
                    </Marker>
                  </MapContainer>
                </div>
              </div>
            )}
            <button 
              className={`w-full py-2 px-4 rounded ${colorPalette.buttonBg} ${colorPalette.buttonText} ${colorPalette.buttonHover} transition-colors duration-300`}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.open(event.link, '_blank');
                }
              }}
              aria-label={intl.formatMessage({ id: 'app.event.more.info' }, { title: event.title })}
            >
              {intl.formatMessage({ id: 'app.event.more.info.button' })}
            </button>

          </div>
        </div>
      </div>
    </div>
  )
}