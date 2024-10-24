import React from 'react'
import { Search, Map, List, Settings } from 'lucide-react'
import { useIntl } from 'react-intl'

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
  titleGradient: string;
}

interface HeaderProps {
  filter: string
  setFilter: (filter: string) => void
  manejarKeyPress: (e: React.KeyboardEvent<HTMLInputElement>) => void
  toggleMapView: () => void
  isMapView: boolean
  openSettings: () => void
  colorPalette: ColorPalette
}

const Header: React.FC<HeaderProps> = ({
  filter,
  setFilter,
  manejarKeyPress,
  toggleMapView,
  isMapView,
  openSettings,
  colorPalette
}) => {
  const intl = useIntl()

  return (
    <header className={`${colorPalette.cardBg} shadow-lg sticky top-0 z-10`}>
      <div className="w-full max-w-full py-4 px-6 flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
        <h1 className={`text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r ${colorPalette.titleGradient}`}>
          {intl.formatMessage({ id: 'app.title' })}
        </h1>
        <div className="flex items-center gap-4">
          <div className="relative">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={manejarKeyPress}
              placeholder={intl.formatMessage({ id: 'app.search.placeholder' })}
              className={`${colorPalette.inputBg} ${colorPalette.inputBorder} border-2 rounded-full py-2 px-4 pr-10 focus:outline-none focus:ring-2 focus:ring-${colorPalette.primary} transition-all duration-300 ease-in-out ${colorPalette.text}`}
              aria-label={intl.formatMessage({ id: 'app.search.placeholder' })}
            />
            <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" aria-hidden="true" />
          </div>
          <button
            onClick={toggleMapView}
            className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
            aria-label={intl.formatMessage({ id: isMapView ? 'app.view.list' : 'app.view.map' })}
          >
            {isMapView ? <List size={20} /> : <Map size={20} />}
          </button>
          <button
            onClick={openSettings}
            className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
            aria-label={intl.formatMessage({ id: 'app.open.settings' })}
          >
            <Settings size={20} />
          </button>
        </div>
      </div>
    </header>
  )
}

export default Header