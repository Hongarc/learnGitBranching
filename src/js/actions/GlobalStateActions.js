const AppConstants = require('../constants/AppConstants');
const AppDispatcher = require('../dispatcher/AppDispatcher');

const { ActionTypes } = AppConstants;

const GlobalStateActions = {

  changeIsAnimating(isAnimating) {
    AppDispatcher.handleViewAction({
      type: ActionTypes.CHANGE_IS_ANIMATING,
      isAnimating,
    });
  },

  levelSolved() {
    AppDispatcher.handleViewAction({
      type: ActionTypes.LEVEL_SOLVED,
    });
  },

  disableLevelInstructions() {
    AppDispatcher.handleViewAction({
      type: ActionTypes.DISABLE_LEVEL_INSTRUCTIONS,
    });
  },

  changeFlipTreeY(flipTreeY) {
    AppDispatcher.handleViewAction({
      type: ActionTypes.CHANGE_FLIP_TREE_Y,
      flipTreeY,
    });
  },

};

module.exports = GlobalStateActions;
