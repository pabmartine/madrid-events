'use client'

import React, { useState, useEffect, ReactNode } from 'react'; // Asegúrate de importar ReactNode
import { IntlProvider } from 'react-intl';
import Spanish from '../locales/es.json';
import English from '../locales/en.json';

const messages = {
  es: Spanish,
  en: English,
};

interface LanguageProviderProps {
  children: ReactNode; // Define el tipo para children
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const [locale, setLocale] = useState<'es' | 'en'>('en'); // Restringir locale a 'es' o 'en'

  useEffect(() => {
    const language = navigator.language.split(/[-_]/)[0];
    setLocale(language in messages ? (language as 'es' | 'en') : 'en'); // Asegurar que el locale sea válido
  }, []);

  return (
    <IntlProvider messages={messages[locale]} locale={locale} defaultLocale="en">
      {children}
    </IntlProvider>
  );
};
