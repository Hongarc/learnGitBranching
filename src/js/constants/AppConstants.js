const keyMirror = require('../util/keyMirror');

const CHANGE_EVENT = 'change';

module.exports = {

  CHANGE_EVENT,

  StoreSubscribePrototype: {
    subscribe(callback) {
      this.on(CHANGE_EVENT, callback);
    },

    unsubscribe(callback) {
      this.removeListener(CHANGE_EVENT, callback);
    },
  },

  ActionTypes: keyMirror({
    SET_LEVEL_SOLVED: null,
    RESET_LEVELS_SOLVED: null,
    CHANGE_IS_ANIMATING: null,
    CHANGE_FLIP_TREE_Y: null,
    SUBMIT_COMMAND: null,
    CHANGE_LOCALE: null,
    CHANGE_LOCALE_FROM_HEADER: null,
    DISABLE_LEVEL_INSTRUCTIONS: null,
    /**
     * only dispatched when you actually
     * solve the level, not ask for solution
     * or solve it again.
     */
    SOLVE_LEVEL: null,
  }),

  PayloadSources: keyMirror({
    VIEW_ACTION: null,
    URI_ACTION: null,
  }),
};
