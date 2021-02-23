const { EventEmitter } = require('events');
const AppConstants = require('../constants/AppConstants');
const AppDispatcher = require('../dispatcher/AppDispatcher');

const { ActionTypes } = AppConstants;
const COMMAND_HISTORY_KEY = 'lgb_CommandHistory';
const COMMAND_HISTORY_MAX_LENGTH = 100;
const COMMAND_HISTORY_TO_KEEP = 10;

let _commandHistory = [];
try {
  _commandHistory = JSON.parse(
    localStorage.getItem(COMMAND_HISTORY_KEY) || '[]',
  ) || [];
} catch (error) {}

function _checkForSize() {
  // if our command line history is too big...
  if (_commandHistory.length > COMMAND_HISTORY_MAX_LENGTH) {
    // grab the last 10
    _commandHistory = _commandHistory.slice(0, COMMAND_HISTORY_TO_KEEP);
  }
}

function _saveToLocalStorage() {
  try {
    localStorage.setItem(
      COMMAND_HISTORY_KEY,
      JSON.stringify(_commandHistory),
    );
  } catch (error) {}
}

var CommandLineStore = {

  ...EventEmitter.prototype,
  ...AppConstants.StoreSubscribePrototype,
  getMaxHistoryLength() {
    return COMMAND_HISTORY_MAX_LENGTH;
  },

  getCommandHistoryLength() {
    return _commandHistory.length;
  },

  getCommandHistory() {
    return _commandHistory.slice(0);
  },

  dispatchToken: AppDispatcher.register((payload) => {
    const { action } = payload;
    let shouldInform = false;

    switch (action.type) {
      case ActionTypes.SUBMIT_COMMAND:
        _commandHistory.unshift(String(action.text));
        _checkForSize();
        _saveToLocalStorage();
        shouldInform = true;
        break;
      case ActionTypes.CHANGE_FLIP_TREE_Y:
        break;
    }

    if (shouldInform) {
      CommandLineStore.emit(AppConstants.CHANGE_EVENT);
    }
  }),
};

module.exports = CommandLineStore;
