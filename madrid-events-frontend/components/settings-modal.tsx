import React, { useState, useEffect } from 'react';
import {
  X,
  Moon,
  Sun,
  ImageIcon,
  ImageOff,
  Locate,
  LocateFixed,
  Calendar,
  CalendarX2,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { useIntl } from 'react-intl';

// Definir la interfaz para los props
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSettings: {
    isDarkMode: boolean;
    showCarousel: boolean;
    geoLocation: { lat: number; lon: number } | null;
    pastEvents: boolean; // Añadido el campo pastEvents
  };
  colorPalette: {
    cardBg: string;
    titleText: string;
    text: string;
    inputBg: string;
    inputBorder: string;
    buttonBg: string;
    buttonText: string;
    buttonHover: string;
  };
  onSaveSettings: (settings: {
    isDarkMode: boolean;
    showCarousel: boolean;
    geoLocation: { lat: number; lon: number } | null;
    pastEvents: boolean; // Añadido el campo pastEvents
  }) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialSettings,
  colorPalette,
  onSaveSettings,
}) => {
  const intl = useIntl();
  const [localSettings, setLocalSettings] = useState(initialSettings);
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [mapCenter, setMapCenter] = useState(
    initialSettings.geoLocation
      ? [initialSettings.geoLocation.lat, initialSettings.geoLocation.lon]
      : [40.4168, -3.7038],
  );

  useEffect(() => {
    setLocalSettings(initialSettings);
    if (initialSettings.geoLocation) {
      setMapCenter([
        initialSettings.geoLocation.lat,
        initialSettings.geoLocation.lon,
      ]);
      setLatInput(initialSettings.geoLocation.lat.toFixed(6));
      setLonInput(initialSettings.geoLocation.lon.toFixed(6));
    } else {
      setLatInput('');
      setLonInput('');
    }
  }, [initialSettings]);

  const handleGeolocation = () => {
    if (navigator.geolocation) {
      const requestLocation = () => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const newLocation = {
              lat: position.coords.latitude,
              lon: position.coords.longitude,
            };
            setLocalSettings((prev) => ({ ...prev, geoLocation: newLocation }));
            setMapCenter([newLocation.lat, newLocation.lon]);
            setLatInput(newLocation.lat.toFixed(6));
            setLonInput(newLocation.lon.toFixed(6));
          },
          (error) => {
            if (error?.code === 1) {
              alert(intl.formatMessage({ id: 'app.geolocation.denied' }));
              return;
            }
            console.error('Error getting location', error);
            alert(intl.formatMessage({ id: 'app.geolocation.error' }));
          },
        );
      };

      if (navigator.permissions?.query) {
        navigator.permissions
          .query({ name: 'geolocation' })
          .then((status) => {
            if (status.state === 'denied') {
              alert(intl.formatMessage({ id: 'app.geolocation.denied' }));
              return;
            }
            requestLocation();
          })
          .catch(() => requestLocation());
      } else {
        requestLocation();
      }
    } else {
      alert(intl.formatMessage({ id: 'app.geolocation.not.supported' }));
    }
  };

  const handleSave = () => {
    const latValue = latInput.trim();
    const lonValue = lonInput.trim();
    let geoLocation = null;

    if (latValue !== '' || lonValue !== '') {
      const lat = Number(latValue);
      const lon = Number(lonValue);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        alert(intl.formatMessage({ id: 'app.settings.location.invalid' }));
        return;
      }
      geoLocation = { lat, lon };
    }

    onSaveSettings({ ...localSettings, geoLocation });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[9999]">
      <div
        className={`${colorPalette.cardBg} p-6 rounded-lg w-96 max-w-full max-h-[90vh] overflow-y-auto relative`}
      >
        <button
          onClick={onClose}
          className={`absolute top-2 right-2 ${colorPalette.cardBg} rounded-full p-2 transition-all duration-200 ease-out hover:bg-opacity-80`}
        >
          <X size={24} />
        </button>

        <h2 className={`${colorPalette.titleText} text-2xl font-bold mb-4`}>
          {intl.formatMessage({ id: 'app.settings.title' })}
        </h2>

        <div className="space-y-4">
          {/* Opción de tema */}
          <div className="flex items-center justify-between">
            <span className={colorPalette.text}>
              {intl.formatMessage({ id: 'app.settings.theme' })}
            </span>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  isDarkMode: !prev.isDarkMode,
                }))
              }
              className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
              aria-label={intl.formatMessage({
                id: localSettings.isDarkMode
                  ? 'app.settings.theme.dark'
                  : 'app.settings.theme.light',
              })}
            >
              {localSettings.isDarkMode ? (
                <Moon size={20} />
              ) : (
                <Sun size={20} />
              )}
            </button>
          </div>

          {/* Opción de carousel */}
          <div className="flex items-center justify-between">
            <span className={colorPalette.text}>
              {intl.formatMessage({ id: 'app.settings.carousel' })}
            </span>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  showCarousel: !prev.showCarousel,
                }))
              }
              className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
              aria-label={intl.formatMessage({
                id: localSettings.showCarousel
                  ? 'app.settings.on'
                  : 'app.settings.off',
              })}
            >
              {localSettings.showCarousel ? (
                <ImageIcon size={20} />
              ) : (
                <ImageOff size={20} />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className={colorPalette.text}>
              {intl.formatMessage({ id: 'app.settings.pastEvents' })}
            </span>
            <button
              onClick={() =>
                setLocalSettings((prev) => ({
                  ...prev,
                  pastEvents: !prev.pastEvents,
                }))
              }
              className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
              aria-label={intl.formatMessage({
                id: localSettings.pastEvents
                  ? 'app.settings.on'
                  : 'app.settings.off',
              })}
            >
              {localSettings.pastEvents ? (
                <Calendar size={20} />
              ) : (
                <CalendarX2 size={20} />
              )}
            </button>
          </div>

          {/* Resto de opciones y configuración */}
          <div className="space-y-2">
            <span className={colorPalette.text}>
              {intl.formatMessage({ id: 'app.settings.location' })}
            </span>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                inputMode="decimal"
                value={latInput}
                onChange={(event) => setLatInput(event.target.value)}
                placeholder="40.4168"
                className={`${colorPalette.inputBg} ${colorPalette.inputBorder} border rounded px-2 py-1 w-1/2`}
              />
              <input
                type="text"
                inputMode="decimal"
                value={lonInput}
                onChange={(event) => setLonInput(event.target.value)}
                placeholder="-3.7038"
                className={`${colorPalette.inputBg} ${colorPalette.inputBorder} border rounded px-2 py-1 w-1/2`}
              />
              <button
                onClick={handleGeolocation}
                className={`p-2 rounded-full ${colorPalette.buttonBg} ${colorPalette.buttonText}`}
                aria-label={intl.formatMessage({ id: 'app.settings.locate' })}
              >
                {localSettings.geoLocation ? (
                  <LocateFixed size={20} />
                ) : (
                  <Locate size={20} />
                )}
              </button>
            </div>
            <p className={`${colorPalette.text} text-xs opacity-80`}>
              {intl.formatMessage({ id: 'app.settings.location.hint' })}
            </p>
          </div>

          <div className="h-48 mt-4">
            <MapContainer
              center={
                mapCenter.length === 2
                  ? (mapCenter as [number, number])
                  : [40.4168, -3.7038]
              }
              zoom={13}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {localSettings.geoLocation && (
                <Marker
                  position={[
                    localSettings.geoLocation.lat,
                    localSettings.geoLocation.lon,
                  ]}
                >
                  <Popup>
                    {intl.formatMessage({ id: 'app.settings.your.location' })}
                  </Popup>
                </Marker>
              )}
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

export default SettingsModal;
