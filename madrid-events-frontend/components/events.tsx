'use client'

import React, { useState, useEffect, KeyboardEvent, useCallback } from 'react'
// Removed unused import
import 'leaflet/dist/leaflet.css'
import { useIntl } from 'react-intl';

import { lightPalette, darkPalette } from '../styles/color-palettes'
import { Event, FilterState, SortState } from '../types/types'

import ErrorMessage from './error-message'
import Toast from './toast'
import SettingsModal from './settings-modal'
import AutoCarousel from './auto-carousel'
// Removed duplicate import of EventModal
import EventModal, { EventModalProps } from './event-modal';
import EventCard from './event-card'
import EventMap from './event-map'
import Header from './header'
import FilterNav from './filter-nav'
import Footer from './footer'


const API_HOST = process.env.NEXT_PUBLIC_API_HOST;
if (!API_HOST) throw new Error('NEXT_PUBLIC_API_HOST environment variable is not set.');
const API_PORT = process.env.NEXT_PUBLIC_API_PORT;
if (!API_PORT) throw new Error('NEXT_PUBLIC_API_PORT environment variable is not set.');



const ITEMS_PER_PAGE = 20;



const lazyLoadComponent = (factory: () => Promise<{ default: React.FC<EventModalProps> }>) => {
  return React.lazy(() => 
    new Promise<{ default: React.FC<EventModalProps> }>(resolve => {
      setTimeout(() => {
        resolve(factory());
      }, 100);
    })
  );
};




const LazyEventModal = lazyLoadComponent(() => 
  Promise.resolve({ default: EventModal })
);

export function Events() {
  const intl = useIntl();
  const [shouldResetMapView, setShouldResetMapView] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const handleResetViewComplete = useCallback(() => {
    setShouldResetMapView(false);
  }, []);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      return savedTheme === 'dark';
    }
    return false;
  });
  const [showCarousel, setShowCarousel] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedCarouselState = localStorage.getItem('showCarousel');
      return savedCarouselState === null ? true : savedCarouselState === 'true';
    }
    return true;
  });
  const colorPalette = isDarkMode ? darkPalette : lightPalette;
  const [events, setEvents] = useState<Event[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<Event[]>([]);
  const [visibleEvents, setVisibleEvents] = useState<Event[]>([]);
  const [filter, setFilter] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
const [distance] = useState<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [filterState, setFilterState] = useState<FilterState>({
    today: true,
    thisWeek: false,
    thisWeekend: false,
    thisMonth: false,
    free: false,
    children: false,
  });
  const [sortState, setSortState] = useState<SortState>({ by: 'distance', order: 'asc' });
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [isMapView, setIsMapView] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedMapViewState = localStorage.getItem('isMapView');
      return savedMapViewState === 'true';
    }
    return false;
  });

  const loadMoreEvents = useCallback(() => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    const nextPage = page + 1;
    const startIndex = (nextPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const nextBatch = filteredEvents.slice(startIndex, endIndex);
    setVisibleEvents(prev => [...prev, ...nextBatch]);
    setPage(nextPage);
    setIsLoading(false);
    setHasMore(endIndex < filteredEvents.length);
  }, [filteredEvents, page, isLoading, hasMore]);

  const updateEventState = useCallback((updatedEvent: Event) => {
    setEvents(prevEvents => prevEvents.map(e => 
      e.id === updatedEvent.id ? updatedEvent : e
    ));
    setFilteredEvents(prevEvents => prevEvents.map(e => 
      e.id === updatedEvent.id ? updatedEvent : e
    ));
    setVisibleEvents(prevEvents => prevEvents.map(e => 
      e.id === updatedEvent.id ? updatedEvent : e
    ));
  }, []);

  const fetchEvents = useCallback(async () => {
    const params = new URLSearchParams();
    if (latitude !== null) params.append('latitude', latitude.toString());
    if (longitude !== null) params.append('longitude', longitude.toString());
    if (distance !== null) params.append('distance', distance.toString());

    try {
      const response = await fetch(`${API_HOST}:${API_PORT}/getEvents?${params.toString()}`);
      if (!response.ok) {
        console.log(response);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: Event[] = await response.json();
      if (Array.isArray(data)) {
        setEvents(data);
        setFilteredEvents(data);
        setVisibleEvents(data.slice(0, ITEMS_PER_PAGE));
        setHasMore(data.length > ITEMS_PER_PAGE);

        // Procesar events de manera secuencial
        for (const event of data) {
          let updatedEvent = { ...event };

          // Recuperar y actualizar la imagen solo si no existe
          if (event.link && !event.image) {
            try {
              const imageResponse = await fetch(`${API_HOST}:${API_PORT}/getImage?id=${encodeURIComponent(event.id)}`);
              if (imageResponse.ok) {
                const imageResult = await imageResponse.json();
                updatedEvent = { ...updatedEvent, image: imageResult.image };
                updateEventState(updatedEvent);
              }
            } catch (error) {
              console.error('Error getting the image:', error);
            }
          }

          // Recuperar y actualizar las líneas de metro
          if (event.subway && (!event.subwayLines || event.subwayLines.length === 0)) {
            try {
              const subwayResponse = await fetch(`${API_HOST}:${API_PORT}/getSubwayLines?subway=${encodeURIComponent(event.subway)}`);
              if (subwayResponse.ok) {
                const subwayResult = await subwayResponse.json();
                updatedEvent = { ...updatedEvent, subwayLines: subwayResult.lines };
                updateEventState(updatedEvent);
              }
            } catch (error) {
              console.error('Error in obtaining metro lines:', error);
            }
          }
        }

        setError(null);
      } else {
        throw new Error('The service response is not an array');
      }
    } catch (error) {
      console.error('Error loading events:', error);
      setError(intl.formatMessage({ id: 'app.error.loading.events' }));
    }
  }, [latitude, longitude, distance, updateEventState, intl]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('showCarousel', showCarousel.toString());
  }, [showCarousel]);

  const isDateExcluded = useCallback((date: Date, excludedDays: string): boolean => {
    if (!excludedDays) return false;
    const formattedDate = date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '/');
    return excludedDays.split(';').includes(formattedDate);
  }, []);

  const [activeSearch, setActiveSearch] = useState(false);

  
const applyFiltersAndSort = useCallback(() => {
  let filteredEvents = events;

  // Aplicar filters
  const applyDateFilter = (startDate: Date, endDate: Date) => {
    // Configurar las horas según el filtro seleccionado
    startDate.setHours(0, 0, 0, 0);    // 00:00 para el inicio
    endDate.setHours(23, 59, 59, 999); // 23:59 para el final

    return filteredEvents.filter(event => {
      const initDate = new Date(event.dtstart);
      const finishDate = new Date(event.dtend);

      // Comparar tanto fecha como hora exacta
      return (
        initDate <= endDate && finishDate >= startDate &&
        !isDateExcluded(startDate, event["excluded-days"]) &&
        !isDateExcluded(endDate, event["excluded-days"])
      );
    });
  };

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  if (filterState.today) {
    filteredEvents = applyDateFilter(today, today);
  }
  if (filterState.thisWeek) {
    filteredEvents = applyDateFilter(weekStart, weekEnd);
  }
  if (filterState.thisWeekend) {
    const weekendStart = new Date(weekEnd);
    weekendStart.setDate(weekEnd.getDate() - 1);
    filteredEvents = applyDateFilter(weekendStart, weekEnd);
  }
  if (filterState.thisMonth) {
    filteredEvents = applyDateFilter(today, monthEnd);
  }
  if (filterState.free) {
    filteredEvents = filteredEvents.filter(event => event.free);
  }
  if (filterState.children) {
    filteredEvents = filteredEvents.filter(event =>
      event.audience && event.audience.toLowerCase().includes('niños')
    );
  }

  // Aplicar ordenación
  filteredEvents.sort((a, b) => {
    if (sortState.by === 'date') {
      const dateA = new Date(a.dtstart).getTime();
      const dateB = new Date(b.dtstart).getTime();
      return sortState.order === 'asc' ? dateA - dateB : dateB - dateA;
    } else if (sortState.by === 'distance') {
      const distanceA = a.distance ?? Infinity;
      const distanceB = b.distance ?? Infinity;

      if (distanceA === Infinity && distanceB === Infinity) {
        return 0;
      }

      return sortState.order === 'asc' 
        ? distanceA - distanceB 
        : distanceB - distanceA;
    }
    return 0;
  });

  setFilteredEvents(filteredEvents);
  setVisibleEvents(filteredEvents.slice(0, ITEMS_PER_PAGE));
  setHasMore(filteredEvents.length > ITEMS_PER_PAGE);
  setPage(1);
  setShouldResetMapView(true);
}, [events, filterState, sortState, isDateExcluded]);


  useEffect(() => {
    if (!activeSearch) {
      applyFiltersAndSort();
    }
  }, [applyFiltersAndSort, activeSearch]);

  const toggleFilter = useCallback((filter: keyof FilterState) => {
    setFilterState(prevState => {
      const newState = { ...prevState, [filter]: !prevState[filter] };
      if (filter === 'today' || filter === 'thisWeek' || filter === 'thisWeekend' || filter === 'thisMonth') {
        ['today', 'thisWeek', 'thisWeekend', 'thisMonth'].forEach(f => {
          if (f !== filter) newState[f as keyof FilterState] = false;
        });
      }
      return newState;
    });
  }, []);

  const sortEvents = useCallback((by: 'date' | 'distance') => {
    setSortState(prevState => ({
      by,
      order: prevState.by === by && prevState.order === 'asc' ? 'desc' : 'asc'
    }));
  }, []);

  const searchEvents = useCallback(() => {
    const filterLower = filter.toLowerCase();
    const filteredEventsYBuscados = events.filter(event => {
      if (filterLower === 'gratis') {
        return event.free;
      }
      return (
        event.title.toLowerCase().includes(filterLower) ||
        new Date(event.dtstart).toLocaleDateString('es-ES').includes(filterLower) ||
        event.description?.toLowerCase().includes(filterLower) ||
        event["event-location"].toLowerCase().includes(filterLower) ||
        event.locality.toLowerCase().includes(filterLower) ||
        event["organization-name"].toLowerCase().includes(filterLower) ||
        event.distrito.toLowerCase().includes(filterLower) ||
        event.barrio.toLowerCase().includes(filterLower)
      );
    });
    setFilteredEvents(filteredEventsYBuscados);
    setVisibleEvents(filteredEventsYBuscados.slice(0, ITEMS_PER_PAGE));
    setHasMore(filteredEventsYBuscados.length > ITEMS_PER_PAGE);
    setPage(1);
    setActiveSearch(true);
    setShouldResetMapView(true);
  }, [events, filter]);

  const manejarKeyPress = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      searchEvents();
    }
  }, [searchEvents]);

  const handleEventSelect = useCallback((event: Event) => {
    setSelectedEvent(event);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const toggleFilterVisibility = () => {
    setIsFilterOpen(!isFilterOpen);
  };

  const toggleMapView = useCallback(() => {
    setIsMapView(prev => {
      const newValue = !prev;
      localStorage.setItem('isMapView', newValue.toString());
      if (newValue) {
        setShouldResetMapView(true);
      }
      return newValue;
    });
  }, []);


  const scrollbarStyles = `
    .scrollbar-modern::-webkit-scrollbar {
      width: 8px;
    }
    .scrollbar-modern::-webkit-scrollbar-track {
      background: ${colorPalette.cardBg};
    }
    .scrollbar-modern::-webkit-scrollbar-thumb {
      background-color: ${colorPalette.primary};
      border-radius: 20px;
      border: 3px solid ${colorPalette.cardBg};
    }
    .scrollbar-modern {
      scrollbar-width: thin;
      scrollbar-color: ${colorPalette.primary} ${colorPalette.cardBg};
    }
    .scrollbar-hide {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    .scrollbar-hide::-webkit-scrollbar {
      display: none;
    }
  `;
const [geoLocation, setGeoLocation] = useState(() => {
    const savedLocation = localStorage.getItem('lastGeoLocation');
    return savedLocation ? JSON.parse(savedLocation) : null;
});
console.log('geoLocation:', geoLocation);
// });

// const [isLocating, setIsLocating] = useState(false);

  

  useEffect(() => {
    // Cargar configuraciones guardadas al iniciar la aplicación
    const savedTheme = localStorage.getItem('theme');
    const savedCarouselState = localStorage.getItem('showCarousel');
    const savedGeoLocation = localStorage.getItem('lastGeoLocation');

    setSettingsState({
      isDarkMode: savedTheme === 'dark',
      showCarousel: savedCarouselState === null ? true : savedCarouselState === 'true',
      geoLocation: savedGeoLocation ? JSON.parse(savedGeoLocation) : null
    });
  }, []);

interface SettingsState {
  isDarkMode: boolean;
  showCarousel: boolean;
  geoLocation: { lat: number; lon: number } | null;
}

// Estado inicial para settingsState
const [settingsState, setSettingsState] = useState<SettingsState>({
  isDarkMode: false,
  showCarousel: true,
  geoLocation: null, // Asegúrate de que null sea un valor válido
});

const handleSaveSettings = useCallback((newSettings: SettingsState) => {
  setSettingsState(newSettings); // Aquí ahora será válido porque el tipo coincide

  // Aplicar y guardar los cambios
  setIsDarkMode(newSettings.isDarkMode);
  setShowCarousel(newSettings.showCarousel);
  setGeoLocation(newSettings.geoLocation);

  localStorage.setItem('theme', newSettings.isDarkMode ? 'dark' : 'light');
  localStorage.setItem('showCarousel', newSettings.showCarousel.toString());
  localStorage.setItem('lastGeoLocation', JSON.stringify(newSettings.geoLocation));

  if (newSettings.geoLocation && (newSettings.geoLocation.lat !== latitude || newSettings.geoLocation.lon !== longitude)) {
    setLatitude(newSettings.geoLocation.lat);
    setLongitude(newSettings.geoLocation.lon);
    fetchEvents();
  }
}, [latitude, longitude, fetchEvents]);



  return (
    <div className={`min-h-screen ${colorPalette.background}`}>
      
      <Header 
        filter={filter}
        setFilter={setFilter}
        manejarKeyPress={manejarKeyPress}
        toggleMapView={toggleMapView}
        isMapView={isMapView}
        openSettings={() => setIsSettingsModalOpen(true)}
        colorPalette={colorPalette}
      />
      
      <FilterNav 
        isFilterOpen={isFilterOpen}
        toggleFilterVisibility={toggleFilterVisibility}
        isMapView={isMapView}
        sortEvents={sortEvents}
        sortState={sortState}
        toggleFilter={toggleFilter}
        filterState={filterState}
        colorPalette={colorPalette}
      />

      {!isMapView ? (
        <main className="w-full max-w-full px-4 pb-12">
          {error && <ErrorMessage message={error} colorPalette={colorPalette} />}
          {showCarousel && <AutoCarousel events={filteredEvents.slice(0, 5)} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {visibleEvents.map((event, index) => (
              <EventCard 
                key={event.id} 
                event={event} 
                onSelect={handleEventSelect} 
                colorPalette={colorPalette}
                isLast={index === visibleEvents.length - 1}
                onLastElementVisible={loadMoreEvents}
              />
            ))}
          </div>
          {isLoading && (
            <div className="flex justify-center items-center mt-4">
              <div className={`animate-spin rounded-full h-8 w-8 border-b-2 ${colorPalette.buttonBorder}`}></div>
            </div>
          )}
        </main>
      ) : (
        <div className="w-full h-[calc(100vh-64px)] relative">
          <EventMap 
            events={filteredEvents} 
            colorPalette={colorPalette} 
            onEventSelect={handleEventSelect}
            shouldResetView={shouldResetMapView}
            onResetViewComplete={handleResetViewComplete}
          />
        </div>
      )}

      <Footer colorPalette={colorPalette} />
      
      {selectedEvent && (
        <React.Suspense fallback={<div>{intl.formatMessage({ id: 'app.loading' })}</div>}>
          <LazyEventModal event={selectedEvent} onClose={handleCloseModal} colorPalette={colorPalette} />
        </React.Suspense>
      )}

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        initialSettings={settingsState}
        colorPalette={colorPalette}
        onSaveSettings={handleSaveSettings}
      />

      <Toast 
        message={intl.formatMessage({ id: 'app.recalculating.distances' })}
        isVisible={showToast}
        onHide={() => setShowToast(false)}
      />

      <style jsx global>{scrollbarStyles}</style>
    </div>
  );
}