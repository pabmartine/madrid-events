import React from 'react'
import { Calendar, MapPin, ChevronUp, ChevronDown } from 'lucide-react'
import { useIntl } from 'react-intl'
import { FilterState, SortState } from './../types/types'

interface ColorPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  cardBg: string;
  cardBorder: string;
  inputBg: string;
  inputBorder: string;
  buttonBg: string;
  buttonText: string;
  buttonBorder: string;
  buttonHover: string;
  titleGradient: string;
  titleText: string;
}

interface FilterNavProps {
  isFilterOpen: boolean
  toggleFilterVisibility: () => void
  isMapView: boolean
  sortEvents: (by: 'date' | 'distance') => void
  sortState: SortState
  toggleFilter: (filter: keyof FilterState) => void
  filterState: FilterState
  colorPalette: ColorPalette
}

const FilterNav: React.FC<FilterNavProps> = ({
  isFilterOpen,
  toggleFilterVisibility,
  isMapView,
  sortEvents,
  sortState,
  toggleFilter,
  filterState,
  colorPalette
}) => {
  const intl = useIntl()

  return (
    <nav className={`${colorPalette.cardBg} shadow-sm mb-8`}>
      <div className="w-full max-w-full px-6 py-4">
        <button
          onClick={toggleFilterVisibility}
          className={`w-full text-left flex items-center justify-between ${colorPalette.text} hover:${colorPalette.titleText}`}
        >
          <span className="font-semibold">{intl.formatMessage({ id: 'app.filters' })}</span>
          {isFilterOpen ? <ChevronUp /> : <ChevronDown />}
        </button>
        {isFilterOpen && (
          <div className="container mx-auto grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            {!isMapView && (
              <>
                <button
                  onClick={() => sortEvents('date')}
                  className={`flex items-center justify-between px-4 py-2 rounded-full border ${
                    sortState.by === 'date' 
                      ? `border-${colorPalette.primary} ${colorPalette.titleText}` 
                      : `border-gray-600 ${colorPalette.text}`
                  } hover:border-${colorPalette.primary} hover:${colorPalette.titleText} transition-colors duration-200`}
                >
                  <span className="flex items-center">
                    <Calendar size={18} className="mr-2" />
                    {intl.formatMessage({ id: 'app.sort.date' })}
                  </span>
                  {sortState.by === 'date' && (
                    sortState.order === 'asc' ? <ChevronUp size={18} /> : <ChevronDown size={18} />
                  )}
                </button>

                <button
                  onClick={() => sortEvents('distance')}
                  className={`flex items-center justify-between px-4 py-2 rounded-full border ${
                    sortState.by === 'distance' 
                      ? `border-${colorPalette.primary} ${colorPalette.titleText}` 
                      : `border-gray-600 ${colorPalette.text}`
                  } hover:border-${colorPalette.primary} hover:${colorPalette.titleText} transition-colors duration-200`}
                >
                  <span className="flex items-center">
                    <MapPin size={18} className="mr-2" />
                    {intl.formatMessage({ id: 'app.sort.distance' })}
                  </span>
                  {sortState.by === 'distance' && (
                    sortState.order === 'asc' ? <ChevronUp size={18} /> : <ChevronDown size={18} />
                  )}
                </button>
              </>
            )}
            {[
              { key: 'today', label: intl.formatMessage({ id: 'app.filter.today' }) },
              { key: 'thisWeek', label: intl.formatMessage({ id: 'app.filter.thisWeek' }) },
              { key: 'thisWeekend', label: intl.formatMessage({ id: 'app.filter.thisWeekend' }) },
              { key: 'thisMonth', label: intl.formatMessage({ id: 'app.filter.thisMonth' }) },
              { key: 'free', label: intl.formatMessage({ id: 'app.filter.free' }) },
              { key: 'children', label: intl.formatMessage({ id: 'app.filter.children' }) }
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => toggleFilter(key as keyof FilterState)}
                className={`px-4 py-2 rounded-full text-sm ${
                  filterState[key as keyof FilterState]
                    ? `${colorPalette.buttonBg} ${colorPalette.buttonText}`
                    : `${colorPalette.cardBg} ${colorPalette.text}`
                } ${colorPalette.buttonHover} transition-colors duration-200`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}

export default FilterNav