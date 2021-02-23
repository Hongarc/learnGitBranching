const { EventEmitter } = require('events');
const AppConstants = require('../constants/AppConstants');
const AppDispatcher = require('../dispatcher/AppDispatcher');
const { levelSequences } = require('../../levels');
const { sequenceInfo } = require('../../levels');
const util = require('../util');

const { ActionTypes } = AppConstants;
const SOLVED_MAP_STORAGE_KEY = 'solvedMap';
const ALIAS_STORAGE_KEY = 'aliasMap';

const _levelMap = {};
let _solvedMap = {};
const _sequences = [];

if (!util.isBrowser()) {
  // https://stackoverflow.com/a/26177872/6250402
  const storage = {};
  var localStorage = {
    setItem(key, value) {
      storage[key] = value || '';
    },
    getItem(key) {
      return key in storage ? storage[key] : null;
    },
    removeItem(key) {
      delete storage[key];
    },
    get length() {
      return Object.keys(storage).length;
    },
    key(index) {
      const keys = Object.keys(storage);
      return keys[index] || null;
    },
  };
} else {
  var { localStorage } = window;
}

try {
  _solvedMap = JSON.parse(
    localStorage.getItem(SOLVED_MAP_STORAGE_KEY) || '{}',
  ) || {};
} catch (error) {
  console.warn('local storage failed', error);
}

function _syncToStorage() {
  try {
    localStorage.setItem(SOLVED_MAP_STORAGE_KEY, JSON.stringify(_solvedMap));
  } catch (error) {
    console.warn('local storage failed on set', error);
  }
}

function getAliasMap() {
  try {
    return JSON.parse(localStorage.getItem(ALIAS_STORAGE_KEY) || '{}') || {};
  } catch (error) {
    return {};
  }
}

function addToAliasMap(alias, expansion) {
  const aliasMap = getAliasMap();
  aliasMap[alias] = expansion;
  localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(aliasMap));
}

function removeFromAliasMap(alias) {
  const aliasMap = getAliasMap();
  delete aliasMap[alias];
  localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(aliasMap));
}

const validateLevel = function (level) {
  level = level || {};
  const requiredFields = [
    'name',
    'goalTreeString',
    // 'description',
    'solutionCommand',
  ];

  for (const field of requiredFields) {
    if (level[field] === undefined) {
      console.log(level);
      throw new Error(`I need this field for a level: ${field}`);
    }
  }
};

/**
 * Unpack the level sequences.
 */
for (const levelSequenceName of Object.keys(levelSequences)) {
  const levels = levelSequences[levelSequenceName];
  _sequences.push(levelSequenceName);
  if (!levels || levels.length === 0) {
    throw new Error('no empty sequences allowed');
  }

  // for this particular sequence...
  for (const [index, level] of levels.entries()) {
    validateLevel(level);

    const id = levelSequenceName + String(index + 1);
    const compiledLevel = {

      ...level,
      index,
      id,
      sequenceName: levelSequenceName,
    };

    // update our internal data
    _levelMap[id] = compiledLevel;
    levelSequences[levelSequenceName][index] = compiledLevel;
  }
}

var LevelStore = {

  ...EventEmitter.prototype,
  ...AppConstants.StoreSubscribePrototype,
  getAliasMap,
  addToAliasMap,
  removeFromAliasMap,

  getSequenceToLevels() {
    return levelSequences;
  },

  getSequences() {
    return Object.keys(levelSequences);
  },

  getLevelsInSequence(sequenceName) {
    if (!levelSequences[sequenceName]) {
      throw new Error(`that sequecne name ${sequenceName}does not exist`);
    }
    return levelSequences[sequenceName];
  },

  getSequenceInfo(sequenceName) {
    return sequenceInfo[sequenceName];
  },

  getLevel(id) {
    return _levelMap[id];
  },

  getNextLevel(id) {
    if (!_levelMap[id]) {
      console.warn("that level doesn't exist!!!");
      return null;
    }

    // meh, this method could be better. It's a trade-off between
    // having the sequence structure be really simple JSON
    // and having no connectivity information between levels, which means
    // you have to build that up yourself on every query
    const level = _levelMap[id];
    const { sequenceName } = level;
    const sequence = levelSequences[sequenceName];

    const nextIndex = level.index + 1;
    if (nextIndex < sequence.length) {
      return sequence[nextIndex];
    }

    const nextSequenceIndex = _sequences.indexOf(sequenceName) + 1;
    if (nextSequenceIndex < _sequences.length) {
      const nextSequenceName = _sequences[nextSequenceIndex];
      return levelSequences[nextSequenceName][0];
    }

    // they finished the last level!
    return null;
  },

  isLevelSolved(levelID) {
    if (!_levelMap[levelID]) {
      throw new Error("that level doesn't exist!");
    }
    return !!_solvedMap[levelID];
  },

  dispatchToken: AppDispatcher.register((payload) => {
    const { action } = payload;
    let shouldInform = false;

    switch (action.type) {
      case ActionTypes.RESET_LEVELS_SOLVED:
        _solvedMap = {};
        _syncToStorage();
        shouldInform = true;
        break;
      case ActionTypes.SET_LEVEL_SOLVED:
        _solvedMap[action.levelID] = true;
        _syncToStorage();
        shouldInform = true;
        break;
    }

    if (shouldInform) {
      LevelStore.emit(AppConstants.CHANGE_EVENT);
    }
  }),
};

module.exports = LevelStore;
