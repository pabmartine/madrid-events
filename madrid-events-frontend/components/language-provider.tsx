'use client'

import React, { useState, useEffect } from 'react';
import { IntlProvider } from 'react-intl';
import Spanish from '../locales/es.json';
import English from '../locales/en.json';

const messages = {
  'es': Spanish,
  'en': English,
};

export const LanguageProvider: React.FC = ({ children }) => {
  const [locale, setLocale] = useState('en');

  useEffect(() => {
    const language = navigator.language.split(/[-_]/)[0];
    setLocale(language in messages ? language : 'en');
  }, []);

  return (
    <IntlProvider messages={messages[locale]} locale={locale} defaultLocale="en">
      {children}
    </IntlProvider>
  );
};