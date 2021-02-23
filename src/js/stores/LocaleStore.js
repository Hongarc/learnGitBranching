const { EventEmitter } = require('events');
const AppConstants = require('../constants/AppConstants');
const AppDispatcher = require('../dispatcher/AppDispatcher');
const util = require('../util');

const { ActionTypes } = AppConstants;
const DEFAULT_LOCALE = 'en_US';

// resolve the messy mapping between browser language
// and our supported locales
const langLocaleMap = {
  en: 'en_US',
  zh: 'zh_CN',
  ja: 'ja',
  ko: 'ko',
  es: 'es_AR',
  fr: 'fr_FR',
  de: 'de_DE',
  pt: 'pt_BR',
  ru: 'ru_RU',
  uk: 'uk',
  vi: 'vi',
  sl: 'sl_SI',
  pl: 'pl',
  ta: 'ta_IN',
};

const headerLocaleMap = {
  'zh-CN': 'zh_CN',
  'zh-TW': 'zh_TW',
  'pt-BR': 'pt_BR',
  'es-MX': 'es_MX',
  'es-ES': 'es_ES',
  'sl-SI': 'sl_SI',
};

const supportedLocalesList = [...Object.values(langLocaleMap), ...Object.values(headerLocaleMap)]
  .filter((value, index, self) => self.indexOf(value) === index);

function _getLocaleFromHeader(langString) {
  const languages = langString.split(',');
  let desiredLocale;
  for (const language of languages) {
    const header = language.split(';')[0];
    // first check the full string raw
    if (headerLocaleMap[header]) {
      desiredLocale = headerLocaleMap[header];
      break;
    }

    const lang = header.slice(0, 2);
    if (langLocaleMap[lang]) {
      desiredLocale = langLocaleMap[lang];
      break;
    }
  }
  return desiredLocale;
}

let _locale = DEFAULT_LOCALE;
var LocaleStore = {

  ...EventEmitter.prototype,
  ...AppConstants.StoreSubscribePrototype,
  getDefaultLocale() {
    return DEFAULT_LOCALE;
  },

  getLangLocaleMap() {
    return { ...langLocaleMap };
  },

  getHeaderLocaleMap() {
    return { ...headerLocaleMap };
  },

  getLocale() {
    return _locale;
  },

  getSupportedLocales() {
    return supportedLocalesList.slice();
  },

  dispatchToken: AppDispatcher.register((payload) => {
    const { action } = payload;
    let shouldInform = false;
    const oldLocale = _locale;

    switch (action.type) {
      case ActionTypes.CHANGE_LOCALE:
        _locale = action.locale;
        shouldInform = true;
        break;
      case ActionTypes.CHANGE_LOCALE_FROM_HEADER:
        var value = _getLocaleFromHeader(action.header);
        if (value) {
          _locale = value;
          shouldInform = true;
        }
        break;
    }

    if (util.isBrowser() && oldLocale !== _locale) {
      const url = new URL(document.location.href);
      url.searchParams.set('locale', _locale);
      window.history.replaceState({}, '', url.href);
    }

    if (shouldInform) {
      LocaleStore.emit(AppConstants.CHANGE_EVENT);
    }
  }),
};

module.exports = LocaleStore;
