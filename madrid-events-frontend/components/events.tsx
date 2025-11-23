'use client';

import React, {
  useState,
  useEffect,
  KeyboardEvent,
  useCallback,
  useMemo,
} from 'react';
import 'leaflet/dist/leaflet.css';
import dynamic from 'next/dynamic';
import { useIntl } from 'react-intl';

import { lightPalette, darkPalette } from '../styles/color-palettes';
import { Event, FilterState, SortState } from '../types/types';
import ErrorMessage from './error-message';
import Toast from './toast';
import AutoCarousel from './auto-carousel';
import EventModal, { EventModalProps } from './event-modal';
import EventCard from './event-card';
import EventMap from './event-map';
import Header from './header';
import FilterNav from './filter-nav';
import Footer from './footer';

const SettingsModal = dynamic(() => import('./settings-modal'), {
  ssr: false,
});

const API_HOST = process.env.NEXT_PUBLIC_API_HOST;
const API_PORT = process.env.NEXT_PUBLIC_API_PORT;

if (!API_HOST) {
  throw new Error('NEXT_PUBLIC_API_HOST environment variable is not set.');
}
if (!API_PORT) {
  throw new Error('NEXT_PUBLIC_API_PORT environment variable is not set.');
}

const ITEMS_PER_PAGE = 20;
const DEFAULT_FILTER_STATE: FilterState = {
  today: false,
  thisWeek: false,
  thisWeekend: false,
  thisMonth: false,
  free: false,
  children: false,
};

type FilterOverrides = {
  includePast?: boolean;
};

const lazyLoadComponent = (
  factory: () => Promise<{ default: React.FC<EventModalProps> }>,
) =>
  React.lazy(
    () =>
      new Promise<{ default: React.FC<EventModalProps> }>((resolve) => {
        setTimeout(() => resolve(factory()), 100);
      }),
  );

const LazyEventModal = lazyLoadComponent(() =>
  Promise.resolve({ default: EventModal }),
);

interface SettingsState {
  isDarkMode: boolean;
  showCarousel: boolean;
  geoLocation: { lat: number; lon: number } | null;
  pastEvents: boolean;
}

const getDateRangeFromFilter = (state: FilterState) => {
  const clampDate = (date: Date, endOfDay = false) => {
    const copy = new Date(date);
    if (endOfDay) {
      copy.setHours(23, 59, 59, 999);
    } else {
      copy.setHours(0, 0, 0, 0);
    }
    return copy;
  };

  if (state.today) {
    const start = clampDate(new Date());
    const end = clampDate(new Date(), true);
    return { start, end };
  }

  if (state.thisWeek) {
    const today = new Date();
    const day = today.getDay() === 0 ? 7 : today.getDay();
    const firstDay = clampDate(
      new Date(today.setDate(today.getDate() - day + 1)),
    );
    const lastDay = clampDate(new Date(firstDay), true);
    lastDay.setDate(firstDay.getDate() + 6);
    return { start: firstDay, end: lastDay };
  }

  if (state.thisWeekend) {
    const today = new Date();
    const saturday = clampDate(
      new Date(today.setDate(today.getDate() - today.getDay() + 6)),
    );
    const sunday = clampDate(new Date(saturday), true);
    sunday.setDate(saturday.getDate() + 1);
    return { start: saturday, end: sunday };
  }

  if (state.thisMonth) {
    const now = new Date();
    const firstDay = clampDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastDay = clampDate(
      new Date(now.getFullYear(), now.getMonth() + 1, 0),
      true,
    );
    return { start: firstDay, end: lastDay };
  }

  return { start: null, end: null };
};

export function Events() {
  const intl = useIntl();
  const [events, setEvents] = useState<Event[]>([]);
  const [searchResults, setSearchResults] = useState<Event[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [filter, setFilter] = useState('');
  const [shouldResetMapView, setShouldResetMapView] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [filterState, setFilterState] = useState<FilterState>(
    DEFAULT_FILTER_STATE,
  );
  const [sortState, setSortState] = useState<SortState>({
    by: 'distance',
    order: 'asc',
  });
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isMapView, setIsMapView] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [mapEvents, setMapEvents] = useState<Event[]>([]);
  const [isMapDataLoading, setIsMapDataLoading] = useState(false);

  const [settingsState, setSettingsState] = useState<SettingsState>({
    isDarkMode: false,
    showCarousel: true,
    geoLocation: null,
    pastEvents: false,
  });

  const [isDarkMode, setIsDarkMode] = useState(false);

  const [showCarousel, setShowCarousel] = useState(true);

  const colorPalette = isDarkMode ? darkPalette : lightPalette;
  const includePastSetting = settingsState.pastEvents;

  useEffect(() => {
    setMapEvents((prev) => (prev.length ? [] : prev));
  }, [filterState, includePastSetting]);

  const handleResetViewComplete = useCallback(() => {
    setShouldResetMapView(false);
  }, []);

  const buildFilterQueryParams = useCallback(
    (overrides?: FilterOverrides) => {
      const params = new URLSearchParams();
      const { start, end } = getDateRangeFromFilter(filterState);
      if (start) params.append('startDate', start.toISOString());
      if (end) params.append('endDate', end.toISOString());
      if (filterState.free) params.append('free', 'true');
      if (filterState.children) params.append('children', 'true');
      const includePastValue =
        typeof overrides?.includePast !== 'undefined'
          ? overrides.includePast
          : includePastSetting;
      if (includePastValue) params.append('includePast', 'true');
      return params;
    },
    [filterState, includePastSetting],
  );

  const sortEvents = useCallback(
    (input: Event[]) => {
      const sorted = [...input];
      if (sortState.by === 'date') {
        sorted.sort((a, b) => {
          const dateA = new Date(a.dtstart).getTime();
          const dateB = new Date(b.dtstart).getTime();
          return sortState.order === 'asc' ? dateA - dateB : dateB - dateA;
        });
      } else if (sortState.by === 'distance') {
        sorted.sort((a, b) => {
          const distanceA = a.distance ?? Infinity;
          const distanceB = b.distance ?? Infinity;
          if (distanceA === Infinity && distanceB === Infinity) return 0;
          return sortState.order === 'asc'
            ? distanceA - distanceB
            : distanceB - distanceA;
        });
      }
      return sorted;
    },
    [sortState],
  );

  const sortedEvents = useMemo(() => sortEvents(events), [events, sortEvents]);
  const sortedSearchResults = useMemo(
    () => sortEvents(searchResults),
    [searchResults, sortEvents],
  );
  const displayedEvents = isSearchMode ? sortedSearchResults : sortedEvents;

  const fetchEvents = useCallback(
    async (
      pageToLoad = 1,
      shouldReset = false,
      overrides?: FilterOverrides,
    ) => {
      setIsLoading(true);
      setError(null);
      const params = buildFilterQueryParams(overrides);
      params.append('limit', ITEMS_PER_PAGE.toString());
      params.append('page', pageToLoad.toString());
      const queryString = params.toString();
      const url = `${API_HOST}:${API_PORT}/getEvents${
        queryString ? `?${queryString}` : ''
      }`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: Event[] = await response.json();
        if (!Array.isArray(data)) {
          throw new Error('The service response is not an array');
        }

        setEvents((prev) => (shouldReset ? data : [...prev, ...data]));
        const totalHeader = response.headers.get('x-total-count');
        if (totalHeader && !Number.isNaN(Number(totalHeader))) {
          const totalCount = Number(totalHeader);
          setHasMore(pageToLoad * ITEMS_PER_PAGE < totalCount);
        } else {
          setHasMore(data.length === ITEMS_PER_PAGE);
        }

        setPage(pageToLoad);
        setShouldResetMapView(true);
      } catch (err) {
        console.error('Error loading events:', err);
        setError(intl.formatMessage({ id: 'app.error.loading.events' }));
      } finally {
        setIsLoading(false);
      }
    },
    [buildFilterQueryParams, intl],
  );

  const fetchAllEventsForMap = useCallback(
    async (overrides?: FilterOverrides) => {
      setIsMapDataLoading(true);
      setError(null);
      const params = buildFilterQueryParams(overrides);
      const queryString = params.toString();
      const url = `${API_HOST}:${API_PORT}/getEvents${
        queryString ? `?${queryString}` : ''
      }`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: Event[] = await response.json();
        if (!Array.isArray(data)) {
          throw new Error('The service response is not an array');
        }

        setMapEvents(data);
        setShouldResetMapView(true);
      } catch (err) {
        console.error('Error loading map events:', err);
        setError(intl.formatMessage({ id: 'app.error.loading.events' }));
      } finally {
        setIsMapDataLoading(false);
      }
    },
    [buildFilterQueryParams, intl],
  );

  const recalculateBaseLocation = useCallback(
    async (lat: number, lon: number) => {
      try {
        setShowToast(true);
        const response = await fetch(
          `${API_HOST}:${API_PORT}/recalculate?lat=${lat}&lon=${lon}`,
        );
        if (!response.ok) {
          throw new Error('Failed to recalculate distances');
        }
        await fetchEvents(1, true);
        setMapEvents((prev) => (prev.length ? [] : prev));
        if (isMapView && !isSearchMode) {
          await fetchAllEventsForMap();
        }
      } catch (err) {
        console.error('Error recalculating distances:', err);
        setError(intl.formatMessage({ id: 'app.recalculation.error' }));
      } finally {
        setShowToast(false);
      }
    },
    [fetchEvents, fetchAllEventsForMap, intl, isMapView, isSearchMode],
  );

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const savedCarouselState = localStorage.getItem('showCarousel');
    const savedGeoLocation = localStorage.getItem('lastGeoLocation');
    const savedPastEvents = localStorage.getItem('pastEvents');
    const savedMapViewState = localStorage.getItem('isMapView');

    setSettingsState({
      isDarkMode: savedTheme === 'dark',
      showCarousel:
        savedCarouselState === null ? true : savedCarouselState === 'true',
      geoLocation: savedGeoLocation ? JSON.parse(savedGeoLocation) : null,
      pastEvents: savedPastEvents === 'true',
    });
    setIsDarkMode(savedTheme === 'dark');
    setShowCarousel(
      savedCarouselState === null ? true : savedCarouselState === 'true',
    );
    setIsMapView(savedMapViewState === 'true');
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('showCarousel', showCarousel.toString());
  }, [showCarousel]);

  useEffect(() => {
    if (!isSearchMode) {
      fetchEvents(1, true);
    }
  }, [fetchEvents, isSearchMode]);

  useEffect(() => {
    if (!isMapView || isSearchMode) {
      return;
    }
    fetchAllEventsForMap();
  }, [fetchAllEventsForMap, isMapView, isSearchMode]);

  useEffect(() => {
    if (filter === '' && isSearchMode) {
      setIsSearchMode(false);
      setSearchResults([]);
      fetchEvents(1, true);
    }
  }, [filter, isSearchMode, fetchEvents]);

  const loadMoreEvents = useCallback(() => {
    if (isLoading || !hasMore || isSearchMode) return;
    const nextPage = page + 1;
    fetchEvents(nextPage, false);
  }, [fetchEvents, hasMore, isLoading, isSearchMode, page]);

  const searchEvents = useCallback(async () => {
    const term = filter.trim();
    if (!term) {
      setIsSearchMode(false);
      setSearchResults([]);
      fetchEvents(1, true);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_HOST}:${API_PORT}/getEvents/search?q=${encodeURIComponent(term)}`,
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: Event[] = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('The service response is not an array');
      }

      setSearchResults(data);
      setIsSearchMode(true);
      setHasMore(false);
      setShouldResetMapView(true);
    } catch (err) {
      console.error('Error searching events:', err);
      const message =
        err instanceof Error ? err.message : 'An unknown error occurred';
      setError(
        intl.formatMessage(
          { id: 'app.error.searching.events' },
          { error: message },
        ),
      );
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [filter, intl, fetchEvents]);

  const manejarKeyPress = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        searchEvents();
      }
    },
    [searchEvents],
  );

  const handleEventSelect = useCallback((event: Event) => {
    setSelectedEvent(event);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const toggleFilterVisibility = () => {
    setIsFilterOpen((prev) => !prev);
  };

  const toggleMapView = useCallback(() => {
    setIsMapView((prev) => {
      const newValue = !prev;
      localStorage.setItem('isMapView', newValue.toString());
      if (newValue) {
        setMapEvents((prevEvents) => (prevEvents.length ? [] : prevEvents));
        setShouldResetMapView(true);
      }
      return newValue;
    });
  }, []);

  const handleSaveSettings = useCallback(
    (newSettings: SettingsState) => {
      setSettingsState(newSettings);
      setIsDarkMode(newSettings.isDarkMode);
      setShowCarousel(newSettings.showCarousel);

      localStorage.setItem('theme', newSettings.isDarkMode ? 'dark' : 'light');
      localStorage.setItem('showCarousel', newSettings.showCarousel.toString());
      localStorage.setItem(
        'lastGeoLocation',
        JSON.stringify(newSettings.geoLocation),
      );
      localStorage.setItem('pastEvents', newSettings.pastEvents.toString());

      if (
        newSettings.geoLocation &&
        (settingsState.geoLocation?.lat !== newSettings.geoLocation.lat ||
          settingsState.geoLocation?.lon !== newSettings.geoLocation.lon)
      ) {
        recalculateBaseLocation(
          newSettings.geoLocation.lat,
          newSettings.geoLocation.lon,
        );
      } else {
        fetchEvents(1, true, { includePast: newSettings.pastEvents });
        if (isMapView && !isSearchMode) {
          fetchAllEventsForMap({ includePast: newSettings.pastEvents });
        } else {
          setMapEvents((prev) => (prev.length ? [] : prev));
        }
      }
    },
    [
      fetchEvents,
      fetchAllEventsForMap,
      isMapView,
      isSearchMode,
      recalculateBaseLocation,
      settingsState.geoLocation,
    ],
  );

  const shouldUseInfiniteScroll = !isMapView && !isSearchMode;
  const eventsForMap = useMemo(() => {
    if (isSearchMode) {
      return sortedSearchResults;
    }
    return mapEvents.length > 0 ? mapEvents : sortedEvents;
  }, [isSearchMode, mapEvents, sortedEvents, sortedSearchResults]);

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
        sortState={sortState}
        filterState={filterState}
        colorPalette={colorPalette}
        onToggleFilter={(filterKey) => {
          setFilterState((prevState) => {
            const newState = { ...prevState, [filterKey]: !prevState[filterKey] };
            if (
              ['today', 'thisWeek', 'thisWeekend', 'thisMonth'].includes(
                filterKey,
              )
            ) {
              ['today', 'thisWeek', 'thisWeekend', 'thisMonth'].forEach(
                (key) => {
                  if (key !== filterKey) {
                    newState[key as keyof FilterState] = false;
                  }
                },
              );
            }
            return newState;
          });
          setIsSearchMode(false);
          setSearchResults([]);
          if (filter) {
            setFilter('');
          }
        }}
        onSortEvents={(by) => {
          setSortState((prevState) => ({
            by,
            order:
              prevState.by === by && prevState.order === 'asc' ? 'desc' : 'asc',
          }));
        }}
      />

      {error && <ErrorMessage message={error} colorPalette={colorPalette} />}

      {!isMapView ? (
        <main className="w-full max-w-full px-4 pb-12">
          {showCarousel && (
            <AutoCarousel events={displayedEvents.slice(0, 5)} />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {displayedEvents.map((event, index) => (
              <EventCard
                key={event.id}
                event={event}
                onSelect={handleEventSelect}
                colorPalette={colorPalette}
                isLast={
                  shouldUseInfiniteScroll &&
                  index === displayedEvents.length - 1
                }
                onLastElementVisible={loadMoreEvents}
              />
            ))}
          </div>
          {isLoading && (
            <div className="flex justify-center items-center mt-4">
              <div
                className={`animate-spin rounded-full h-8 w-8 border-b-2 ${colorPalette.buttonBorder}`}
              ></div>
            </div>
          )}
          {displayedEvents.length === 0 && !isLoading && (
            <p className="text-center mt-8 text-gray-500">
              {intl.formatMessage({ id: 'app.error.loading.events' })}
            </p>
          )}
        </main>
      ) : (
        <main className="w-full flex-1 px-4 pb-12">
          <div className="h-[75vh] w-full rounded-lg overflow-hidden shadow-lg relative">
            <EventMap
              events={eventsForMap}
              colorPalette={colorPalette}
              onEventSelect={handleEventSelect}
              shouldResetView={shouldResetMapView}
              onResetViewComplete={handleResetViewComplete}
            />
            {!isSearchMode && isMapDataLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
                <div
                  className={`animate-spin rounded-full h-8 w-8 border-b-2 ${colorPalette.buttonBorder}`}
                ></div>
              </div>
            )}
          </div>
        </main>
      )}

      <Footer colorPalette={colorPalette} />

      {selectedEvent && (
        <React.Suspense
          fallback={<div>{intl.formatMessage({ id: 'app.loading' })}</div>}
        >
          <LazyEventModal
            event={selectedEvent}
            onClose={handleCloseModal}
            colorPalette={colorPalette}
          />
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
    </div>
  );
}
