const { EventEmitter } = require('events');
const AppConstants = require('../constants/AppConstants');
const AppDispatcher = require('../dispatcher/AppDispatcher');

const { ActionTypes } = AppConstants;

let _isAnimating = false;
let _flipTreeY = false;
let _numberLevelsSolved = 0;
let _disableLevelInstructions = false;

var GlobalStateStore = {

  ...EventEmitter.prototype,
  ...AppConstants.StoreSubscribePrototype,
  getIsAnimating() {
    return _isAnimating;
  },

  getFlipTreeY() {
    return _flipTreeY;
  },

  getNumLevelsSolved() {
    return _numberLevelsSolved;
  },

  getShouldDisableLevelInstructions() {
    return _disableLevelInstructions;
  },

  dispatchToken: AppDispatcher.register((payload) => {
    const { action } = payload;
    let shouldInform = false;

    switch (action.type) {
      case ActionTypes.CHANGE_IS_ANIMATING:
        _isAnimating = action.isAnimating;
        shouldInform = true;
        break;
      case ActionTypes.CHANGE_FLIP_TREE_Y:
        _flipTreeY = action.flipTreeY;
        shouldInform = true;
        break;
      case ActionTypes.LEVEL_SOLVED:
        _numberLevelsSolved++;
        shouldInform = true;
        break;
      case ActionTypes.DISABLE_LEVEL_INSTRUCTIONS:
        _disableLevelInstructions = true;
        shouldInform = true;
        break;
    }

    if (shouldInform) {
      GlobalStateStore.emit(AppConstants.CHANGE_EVENT);
    }
  }),
};

module.exports = GlobalStateStore;
