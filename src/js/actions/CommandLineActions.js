const AppConstants = require('../constants/AppConstants');
const AppDispatcher = require('../dispatcher/AppDispatcher');

const { ActionTypes } = AppConstants;

const CommandLineActions = {

  submitCommand(text) {
    AppDispatcher.handleViewAction({
      type: ActionTypes.SUBMIT_COMMAND,
      text,
    });
  },

};

module.exports = CommandLineActions;
