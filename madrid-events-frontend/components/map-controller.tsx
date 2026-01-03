import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { Event } from '../types/types';

interface MapControllerProps {
  events: Event[];
  shouldResetView: boolean;
  onResetViewComplete: () => void;
}

const MapController: React.FC<MapControllerProps> = ({
  events,
  shouldResetView,
  onResetViewComplete,
}) => {
  const map = useMap();
  const eventsRef = useRef(events);
  const boundsSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const updateMapBounds = async () => {
      const signature = events
        .map((event) =>
          `${event.id}:${event.latitude ?? ''}:${event.longitude ?? ''}`,
        )
        .join('|');

      if (
        !shouldResetView &&
        boundsSignatureRef.current === signature
      ) {
        return;
      }

      const eventsWithCoordinates = events.filter(
        (e) => e.latitude !== null && e.longitude !== null,
      );

      if (eventsWithCoordinates.length > 0) {
        const L = (await import('leaflet')).default;
        if (!isMounted) return;
        const bounds = L.latLngBounds(
          eventsWithCoordinates.map((e) => [
            e.latitude as number,
            e.longitude as number,
          ]),
        );
        map.fitBounds(bounds);
      } else {
        map.setView([40.4168, -3.7038], 12);
      }

      if (isMounted) {
        onResetViewComplete();
        eventsRef.current = events;
        boundsSignatureRef.current = signature;
      }
    };

    updateMapBounds();

    return () => {
      isMounted = false;
    };
  }, [events, map, shouldResetView, onResetViewComplete]);

  return null;
};

export default MapController;
