import React, { useRef, useState, useEffect } from 'react';
import Image from 'next/image';
import { Calendar, MapPin, Clock, Ruler } from 'lucide-react';
import { useIntl } from 'react-intl';
import { Event as EventType } from '../types/types'; // Cambia esto si la importación de Event es diferente

interface EventCardProps {
  event: EventType; // Cambia a tu tipo de evento
  onSelect: (event: EventType) => void;
  colorPalette: {
    cardBg: string;
    cardBorder: string;
    priceBadgeBg: string;
    priceBadgeText: string;
    titleText: string;
    text: string;
    subtitleText: string;
  };
  isLast: boolean;
  onLastElementVisible: () => void;
}

const EventCard: React.FC<EventCardProps> = ({
  event,
  onSelect,
  colorPalette,
  isLast,
  onLastElementVisible,
}) => {
  const intl = useIntl();

  const truncatePrice = (price: string) => {
    return price.length > 5 ? price.substring(0, 5) + '...' : price;
  };

  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
          if (isLast && onLastElementVisible) {
            onLastElementVisible();
          }
        }
      },
      { threshold: 0.1 },
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      if (cardRef.current) {
        observer.unobserve(cardRef.current);
      }
    };
  }, [isLast, onLastElementVisible]);

  return (
    <div
      ref={cardRef}
      className={`transition-all duration-300 ease-out ${
        isVisible
          ? 'opacity-100 transform translate-y-0'
          : 'opacity-0 transform translate-y-4'
      } ${colorPalette.cardBg} ${colorPalette.cardBorder} rounded-xl shadow-lg overflow-hidden transition-all duration-200 ease-out transform hover:scale-105 hover:shadow-xl cursor-pointer h-full flex flex-col`}
      onClick={() => onSelect(event)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect(event);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={intl.formatMessage(
        { id: 'app.event.details' },
        { title: event.title },
      )}
    >
      <div className="relative h-48 overflow-hidden">
        {event.image ? (
          <Image
            src={event.image}
            alt={event.title}
            fill
            objectFit="cover"
            className="transition-transform duration-300 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-700 text-gray-400">
            {intl.formatMessage({ id: 'app.event.no.image' })}
          </div>
        )}
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent to-gray-900 opacity-70" />
        <span
          className={`absolute top-2 right-2 ${colorPalette.priceBadgeBg} ${colorPalette.priceBadgeText} px-2 py-1 rounded-lg text-sm font-bold`}
        >
          {event.free
            ? intl.formatMessage({ id: 'app.event.free' })
            : truncatePrice(
                intl.formatMessage(
                  { id: 'app.event.from' },
                  { price: event.price || '20€' },
                ),
              )}
        </span>
      </div>
      <div className="p-4 flex-grow flex flex-col">
        <h2
          className={`text-xl font-semibold ${colorPalette.titleText} mb-2`}
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
            minHeight: '3em', /* Forces the title to occupy the space equivalent to two lines */
          }}
        >
          {event.title}
        </h2>
        <p className={`${colorPalette.text} line-clamp-2 mb-4 text-sm`} dangerouslySetInnerHTML={{ __html: event.description || intl.formatMessage({ id: 'app.event.description.unavailable' }) }}></p>

        <div className="mt-auto">
          <div
            className={`${colorPalette.subtitleText} mb-2 flex items-center`}
          >
            <MapPin size={16} className="mr-1" />
            <span className="text-sm truncate">
              {event['event-location'] ||
                intl.formatMessage({ id: 'app.event.location.unavailable' })}
            </span>
          </div>
          <div className={`${colorPalette.subtitleText} flex items-center`}>
            <Calendar size={16} className="mr-1" />
            <span className="text-sm">
              {new Date(event.dtstart).toLocaleDateString()}
            </span>
            {event.time && (
              <>
                <Clock size={16} className="ml-2 mr-1" />
                <span className="text-sm">{event.time}</span>
              </>
            )}
          </div>
          <div
            className={`flex items-center justify-between mt-4 pt-4 border-t border-gray-700 ${colorPalette.text}`}
          >
            <div className="flex items-center">
              <Image
                src="/metro.png"
                alt={intl.formatMessage({ id: 'app.event.metro' })}
                width={24}
                height={24}
                className="mr-2"
              />
              <span className="text-sm font-semibold">
                {event.subway ||
                  intl.formatMessage({ id: 'app.map.subway.unavailable' })}
              </span>
              {event.subwayLines && event.subwayLines.length > 0 && (
                <div className="flex ml-2">
                  {event.subwayLines.map((line, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-xs font-bold ml-1"
                      style={{ backgroundColor: line.color }}
                      aria-label={intl.formatMessage(
                        { id: 'app.event.subway.line' },
                        { number: line.number },
                      )}
                    >
                      {line.number}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center">
              <Ruler size={16} className="mr-1" />
              <span className="text-sm font-semibold">
                {event.distance
                  ? intl.formatMessage(
                      { id: 'app.map.distance.km' },
                      { distance: event.distance.toFixed(2) },
                    )
                  : intl.formatMessage({ id: 'app.map.distance.unavailable' })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(EventCard);
