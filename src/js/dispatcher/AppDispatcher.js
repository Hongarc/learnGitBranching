const { Dispatcher } = require('flux');
const AppConstants = require('../constants/AppConstants');

const { PayloadSources } = AppConstants;

const AppDispatcher = new Dispatcher();

AppDispatcher.handleViewAction = function (action) {
  this.dispatch({
    source: PayloadSources.VIEW_ACTION,
    action,
  });
};

AppDispatcher.handleURIAction = function (action) {
  this.dispatch({
    source: PayloadSources.URI_ACTION,
    action,
  });
};

module.exports = AppDispatcher;
