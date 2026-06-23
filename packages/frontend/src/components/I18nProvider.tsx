"use client";

import { useEffect, useState } from "react";
import { I18nextProvider } from "react-i18next";
import i18next from "../i18n/config";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Set document direction for RTL support based on language
    const updateDir = () => {
      document.dir = i18next.dir();
      document.documentElement.lang = i18next.language;
    };
    
    i18next.on('languageChanged', updateDir);
    updateDir(); // Initial set
    
    return () => {
      i18next.off('languageChanged', updateDir);
    };
  }, []);

  // Use a simple rendering without blocking children to allow SSR
  // hydration mismatches might occur for text content, but it's acceptable for now.
  return (
    <I18nextProvider i18n={i18next}>
      {children}
    </I18nextProvider>
  );
}
