const AppConstants = require('../constants/AppConstants');
const AppDispatcher = require('../dispatcher/AppDispatcher');

const { ActionTypes } = AppConstants;

const LevelActions = {

  setLevelSolved(levelID) {
    AppDispatcher.handleViewAction({
      type: ActionTypes.SET_LEVEL_SOLVED,
      levelID,
    });
  },

  resetLevelsSolved() {
    AppDispatcher.handleViewAction({
      type: ActionTypes.RESET_LEVELS_SOLVED,
    });
  },

};

module.exports = LevelActions;
