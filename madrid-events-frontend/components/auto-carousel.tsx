import React, { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { Event } from '../types/types';

const AutoCarousel = ({ events }: { events: Event[] }) => {
  const intl = useIntl();
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % events.length);
    }, 5000);

    return () => clearInterval(timer);
  }, [events.length]);

  const handleClick = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % events.length);
  };

  return (
    <div
      className="relative w-full h-[50vh] overflow-hidden mb-12 rounded-lg shadow-lg cursor-pointer"
      onClick={handleClick}
      role="region"
      aria-label={intl.formatMessage({ id: 'app.event.carousel' })}
    >
      {events.map((event, index) => {
        const imageUrl = event.image || '';
        const backgroundImage = imageUrl ? `url(${imageUrl})` : '';

        return (
          <div
            key={event.id}
            className={`absolute top-0 left-0 w-full h-full transition-all duration-500 ease-in-out ${
              index === currentIndex
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 translate-x-full'
            }`}
            style={{
              backgroundImage,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
            aria-hidden={index !== currentIndex}
          >
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
              <div className="text-center">
                <h2 className="text-4xl md:text-6xl font-bold text-white mb-4 px-4 animate-fade-in-up">
                  {event.title}
                </h2>
                <p className="text-lg text-white">
                  {event['event-location'] ||
                    intl.formatMessage({
                      id: 'app.event.location.unspecified',
                    })}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(AutoCarousel);
