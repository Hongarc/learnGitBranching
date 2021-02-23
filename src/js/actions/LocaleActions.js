const AppConstants = require('../constants/AppConstants');
const AppDispatcher = require('../dispatcher/AppDispatcher');

const { ActionTypes } = AppConstants;

const LocaleActions = {

  changeLocale(newLocale) {
    AppDispatcher.handleViewAction({
      type: ActionTypes.CHANGE_LOCALE,
      locale: newLocale,
    });
  },

  changeLocaleFromURI(newLocale) {
    AppDispatcher.handleURIAction({
      type: ActionTypes.CHANGE_LOCALE,
      locale: newLocale,
    });
  },

  changeLocaleFromHeader(header) {
    AppDispatcher.handleViewAction({
      type: ActionTypes.CHANGE_LOCALE_FROM_HEADER,
      header,
    });
  },
};

module.exports = LocaleActions;
