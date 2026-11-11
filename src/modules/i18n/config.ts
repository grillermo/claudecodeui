/**
 * i18n Configuration
 *
 * The app ships in English only. i18next stays as the place every UI string
 * lives, so components keep reading text through `t()` and none is hard-coded.
 */

import i18n from 'i18next';
import type { ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';

// Every `locales/en/<namespace>.json` file becomes a namespace, so adding one
// needs no change here.
const namespaceFiles = import.meta.glob<ResourceKey>('@/modules/i18n/locales/en/*.json', {
  eager: true,
  import: 'default',
});

// `…/locales/en/git.json` -> `git`
const resources = Object.fromEntries(
  Object.entries(namespaceFiles).map(([filePath, namespace]) => [
    filePath.split('/').pop()?.replace(/\.json$/, '') ?? filePath,
    namespace,
  ]),
);

i18n
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    resources: { en: resources },
    lng: 'en',
    fallbackLng: 'en',

    ns: Object.keys(resources),
    defaultNS: 'common',

    interpolation: {
      escapeValue: false, // React already escapes values
    },
  });

export default i18n;
