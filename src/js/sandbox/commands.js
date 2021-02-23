const util = require('../util');

const constants = require('../util/constants');
const intl = require('../intl');

const Commands = require('../commands');
const Errors = require('../util/errors');

const { CommandProcessError } = Errors;
const LocaleStore = require('../stores/LocaleStore');
const LocaleActions = require('../actions/LocaleActions');
const LevelStore = require('../stores/LevelStore');
const GlobalStateStore = require('../stores/GlobalStateStore');
const GlobalStateActions = require('../actions/GlobalStateActions');

const { GitError } = Errors;
const { Warning } = Errors;
const { CommandResult } = Errors;

const instantCommands = [
  [/^ls( |$)/, function () {
    throw new CommandResult({
      msg: intl.str('ls-command'),
    });
  }],
  [/^cd( |$)/, function () {
    throw new CommandResult({
      msg: intl.str('cd-command'),
    });
  }],
  [/^(locale|locale reset)$/, function (bits) {
    LocaleActions.changeLocale(
      LocaleStore.getDefaultLocale(),
    );

    throw new CommandResult({
      msg: intl.str(
        'locale-reset-command',
        { locale: LocaleStore.getDefaultLocale() },
      ),
    });
  }],
  [/^show$/, function (bits) {
    const lines = [
      intl.str('show-command'),
      '<br/>',
      'show commands',
      'show solution',
      'show goal',
    ];

    throw new CommandResult({
      msg: lines.join('\n'),
    });
  }],
  [/^alias (\w+)="(.+)"$/, function (bits) {
    const alias = bits[1];
    const expansion = bits[2];
    LevelStore.addToAliasMap(alias, expansion);
    throw new CommandResult({
      msg: `Set alias "${alias}" to "${expansion}"`,
    });
  }],
  [/^unalias (\w+)$/, function (bits) {
    const alias = bits[1];
    LevelStore.removeFromAliasMap(alias);
    throw new CommandResult({
      msg: `Removed alias "${alias}"`,
    });
  }],
  [/^locale (\w+)$/, function (bits) {
    LocaleActions.changeLocale(bits[1]);
    throw new CommandResult({
      msg: intl.str(
        'locale-command',
        { locale: bits[1] },
      ),
    });
  }],
  [/^flip$/, function () {
    GlobalStateActions.changeFlipTreeY(
      !GlobalStateStore.getFlipTreeY(),
    );
    require('../app').getEvents().trigger('refreshTree');
    throw new CommandResult({
      msg: intl.str('flip-tree-command'),
    });
  }],
  [/^disableLevelInstructions$/, function () {
    GlobalStateActions.disableLevelInstructions();
    throw new CommandResult({
      msg: intl.todo('Level instructions disabled'),
    });
  }],
  [/^refresh$/, function () {
    const events = require('../app').getEvents();

    events.trigger('refreshTree');
    throw new CommandResult({
      msg: intl.str('refresh-tree-command'),
    });
  }],
  [/^rollup (\d+)$/, function (bits) {
    const events = require('../app').getEvents();

    // go roll up these commands by joining them with semicolons
    events.trigger('rollupCommands', bits[1]);
    throw new CommandResult({
      msg: 'Commands combined!',
    });
  }],
  [/^echo "(.*?)"$|^echo (.*?)$/, function (bits) {
    const message = bits[1] || bits[2];
    throw new CommandResult({
      msg: message,
    });
  }],
  [/^show +commands$/, function (bits) {
    const allCommands = getAllCommands();
    const lines = [
      intl.str('show-all-commands'),
      '<br/>',
    ];
    for (const command of Object.keys(allCommands)) {
      lines.push(command);
    }

    throw new CommandResult({
      msg: lines.join('\n'),
    });
  }],
];

const regexMap = {
  'reset solved': /^reset solved($|\s)/,
  help: /^help( +general)?$|^\?$/,
  reset: /^reset( +--forSolution)?$/,
  delay: /^delay (\d+)$/,
  clear: /^clear($|\s)/,
  'exit level': /^exit level($|\s)/,
  sandbox: /^sandbox($|\s)/,
  level: /^level\s?([\dA-Za-z]*)/,
  levels: /^levels($|\s)/,
  mobileAlert: /^mobile alert($|\s)/,
  'build level': /^build +level\s?([\dA-Za-z]*)$/,
  'export tree': /^export +tree$/,
  importTreeNow: /^importTreeNow($|\s)/,
  importLevelNow: /^importLevelNow($|\s)/,
  'import tree': /^import +tree$/,
  'import level': /^import +level$/,
  undo: /^undo($|\s)/,
  'share permalink': /^share( +permalink)?$/,
};

var getAllCommands = function () {
  const toDelete = [
    'mobileAlert',
  ];

  const allCommands = {

    ...require('../level').regexMap,
    ...regexMap,
  };
  const mRegexMap = Commands.commands.getRegexMap();
  for (const vcs of Object.keys(mRegexMap)) {
    const map = mRegexMap[vcs];
    for (const method of Object.keys(map)) {
      const regex = map[method];
      allCommands[`${vcs} ${method}`] = regex;
    }
  }
  for (const key of toDelete) {
    delete allCommands[key];
  }

  return allCommands;
};

exports.instantCommands = instantCommands;
exports.parse = util.genParseCommand(regexMap, 'processSandboxCommand');

// optimistically parse some level and level builder commands; we do this
// so you can enter things like "level intro1; show goal" and not
// have it barf. when the
// command fires the event, it will check if there is a listener and if not throw
// an error

// note: these are getters / setters because the require kills us
exports.getOptimisticLevelParse = function () {
  return util.genParseCommand(
    require('../level').regexMap,
    'processLevelCommand',
  );
};

exports.getOptimisticLevelBuilderParse = function () {
  return util.genParseCommand(
    require('../level/builder').regexMap,
    'processLevelBuilderCommand',
  );
};
