import React, { useState, useEffect } from 'react'
import { X, Moon, Sun, ImageIcon, ImageOff, Locate, LocateFixed } from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import { useIntl } from 'react-intl'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  initialSettings: any
  colorPalette: any
  onSaveSettings: (settings: any) => void
}

const SettingsModal = ({ 
  isOpen, 
  onClose, 
  initialSettings,
  colorPalette,
  onSaveSettings
}) => {
  const intl = useIntl();
  const [localSettings, setLocalSettings] = useState(initialSettings);
  const [mapCenter, setMapCenter] = useState(
    initialSettings.geoLocation 
      ? [initialSettings.geoLocation.lat, initialSettings.geoLocation.lon] 
      : [40.4168, -3.7038]
  );

  useEffect(() => {
    setLocalSettings(initialSettings);
    if (initialSettings.geoLocation) {
      setMapCenter([initialSettings.geoLocation.lat, initialSettings.geoLocation.lon]);
    }
  }, [initialSettings]);

  const handleGeolocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lon: position.coords.longitude
          };
          setLocalSettings(prev => ({ ...prev, geoLocation: newLocation }));
          setMapCenter([newLocation.lat, newLocation.lon]);
        },
        (error) => {
          console.error("Error getting location", error);
          alert(intl.formatMessage({ id: 'app.geolocation.error' }));
        }
      );
    } else {
      alert(intl.formatMessage({ id: 'app.geolocation.not.supported' }));
    }
  };

  const MapEvents = () => {
    const map = useMapEvents({
      click(e) {
        const { lat, lng } = e.latlng;
        setLocalSettings(prev => ({ ...prev, geoLocation: { lat, lon: lng } }));
        setMapCenter([lat, lng]);
      },
    });
    return null;
  };

  const handleSave = () => {
    onSaveSettings(localSettings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[9999]">
      <div className={`${colorPalette.cardBg} p-6 rounded-lg w-96 max-w-full max-h-[90vh] overflow-y-auto relative`}>
        <button
          onClick={onClose}
          className={`absolute top-2 right-2 ${colorPalette.cardBg} rounded-full p-2 transition-all duration-200 ease-out hover:bg-opacity-80`}
          aria-label={intl.formatMessage({ id: 'app.settings.close' })}
        >
          <X size={24} />
        </button>

        <h2 className={`${colorPalette.titleText} text-2xl font-bold mb-4`}>
          {intl.formatMessage({ id: 'app.settings.title' })}
        </h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className={colorPalette.text}>{intl.formatMessage({ id: 'app.settings.theme' })}</span>
            <button
              onClick={() => setLocalSettings(prev => ({ ...prev, isDarkMode: !prev.isDarkMode }))}
              className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
              aria-label={intl.formatMessage({ id: localSettings.isDarkMode ? 'app.settings.theme.dark' : 'app.settings.theme.light' })}
            >
              {localSettings.isDarkMode ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className={colorPalette.text}>{intl.formatMessage({ id: 'app.settings.carousel' })}</span>
            <button
              onClick={() => setLocalSettings(prev => ({ ...prev, showCarousel: !prev.showCarousel }))}
              className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
              aria-label={intl.formatMessage({ id: localSettings.showCarousel ? 'app.settings.on' : 'app.settings.off' })}
            >
              {localSettings.showCarousel ? <ImageIcon size={20} /> : <ImageOff size={20} />}
            </button>
          </div>

          <div className="space-y-2">
            <span className={colorPalette.text}>{intl.formatMessage({ id: 'app.settings.location' })}</span>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={`${localSettings.geoLocation?.lat?.toFixed(4) || ''}, ${localSettings.geoLocation?.lon?.toFixed(4) || ''}`}
                readOnly
                className={`${colorPalette.inputBg} ${colorPalette.inputBorder} border rounded px-2 py-1 flex-grow`}
              />
              <button
                onClick={handleGeolocation}
                className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
                aria-label={intl.formatMessage({ id: 'app.settings.locate' })}
              >
                {localSettings.geoLocation ? <LocateFixed size={20} /> : <Locate size={20} />}
              </button>
            </div>
          </div>

          <div className="h-48 mt-4">
            <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {localSettings.geoLocation && (
                <Marker position={[localSettings.geoLocation.lat, localSettings.geoLocation.lon]}>
                  <Popup>{intl.formatMessage({ id: 'app.settings.your.location' })}</Popup>
                </Marker>
              )}
              <MapEvents />
            </MapContainer>
          </div>

          <button
            onClick={handleSave}
            className={`w-full mt-4 py-2 px-4 rounded ${colorPalette.buttonBg} ${colorPalette.buttonText} ${colorPalette.buttonHover} transition-colors duration-300`}
          >
            {intl.formatMessage({ id: 'app.settings.save' })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal