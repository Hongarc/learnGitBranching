const GitCommands = require('../git/commands');
const Commands = require('../commands');
const SandboxCommands = require('../sandbox/commands');

// more or less a static class
const ParseWaterfall = function (options) {
  options = options || {};
  this.options = options;
  this.shortcutWaterfall = options.shortcutWaterfall || [
    Commands.commands.getShortcutMap(),
  ];

  this.instantWaterfall = options.instantWaterfall || [
    GitCommands.instantCommands,
    SandboxCommands.instantCommands,
  ];

  // defer the parse waterfall until later...
};

ParseWaterfall.prototype.initParseWaterfall = function () {
  // check for node when testing
  if (!require('../util').isBrowser()) {
    this.parseWaterfall = [Commands.parse];
    return;
  }

  // by deferring the initialization here, we don't require()
  // level too early (which barfs our init)
  this.parseWaterfall = this.options.parseWaterfall || [
    Commands.parse,
    SandboxCommands.parse,
    SandboxCommands.getOptimisticLevelParse(),
    SandboxCommands.getOptimisticLevelBuilderParse(),
  ];
};

ParseWaterfall.prototype.clone = function () {
  return new ParseWaterfall({
    shortcutWaterfall: this.shortcutWaterfall.slice(),
    instantWaterfall: this.instantWaterfall.slice(),
    parseWaterfall: this.parseWaterfall.slice(),
  });
};

ParseWaterfall.prototype.getWaterfallMap = function () {
  if (!this.parseWaterfall) {
    this.initParseWaterfall();
  }
  return {
    shortcutWaterfall: this.shortcutWaterfall,
    instantWaterfall: this.instantWaterfall,
    parseWaterfall: this.parseWaterfall,
  };
};

ParseWaterfall.prototype.addFirst = function (which, value) {
  if (!which || !value) {
    throw new Error('need to know which!!!');
  }
  this.getWaterfallMap()[which].unshift(value);
};

ParseWaterfall.prototype.addLast = function (which, value) {
  this.getWaterfallMap()[which].push(value);
};

ParseWaterfall.prototype.expandAllShortcuts = function (commandString) {
  this.shortcutWaterfall.forEach(function (shortcutMap) {
    commandString = this.expandShortcut(commandString, shortcutMap);
  }, this);
  return commandString;
};

ParseWaterfall.prototype.expandShortcut = function (commandString, shortcutMap) {
  for (const vcs of Object.keys(shortcutMap)) {
    const map = shortcutMap[vcs];
    for (const method of Object.keys(map)) {
      const regex = map[method];
      const results = regex.exec(commandString);
      if (results) {
        commandString = `${vcs} ${method} ${commandString.slice(results[0].length)}`;
      }
    }
  }
  return commandString;
};

ParseWaterfall.prototype.processAllInstants = function (commandString) {
  this.instantWaterfall.forEach(function (instantCommands) {
    this.processInstant(commandString, instantCommands);
  }, this);
};

ParseWaterfall.prototype.processInstant = function (commandString, instantCommands) {
  for (const tuple of instantCommands) {
    const regex = tuple[0];
    const results = regex.exec(commandString);
    if (results) {
      // this will throw a result because it's an instant
      tuple[1](results);
    }
  }
};

ParseWaterfall.prototype.parseAll = function (commandString) {
  if (!this.parseWaterfall) {
    this.initParseWaterfall();
  }

  let toReturn = false;
  this.parseWaterfall.forEach((parseFunction) => {
    const results = parseFunction(commandString);
    if (results) {
      toReturn = results;
    }
  }, this);

  return toReturn;
};

exports.ParseWaterfall = ParseWaterfall;
