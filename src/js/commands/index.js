const intl = require('../intl');

const Errors = require('../util/errors');
const GitCommands = require('../git/commands');
const MercurialCommands = require('../mercurial/commands');

const { CommandProcessError } = Errors;
const { CommandResult } = Errors;

const commandConfigs = {
  git: GitCommands.commandConfig,
  hg: MercurialCommands.commandConfig,
};

const commands = {
  execute(vcs, name, engine, commandObject) {
    if (!commandConfigs[vcs][name]) {
      throw new Error(`i don't have a command for ${name}`);
    }
    const config = commandConfigs[vcs][name];
    if (config.delegate) {
      return this.delegateExecute(config, engine, commandObject);
    }

    config.execute.call(this, engine, commandObject);
  },

  delegateExecute(config, engine, commandObject) {
    // we have delegated to another vcs command, so lets
    // execute that and get the result
    const result = config.delegate.call(this, engine, commandObject);

    if (result.multiDelegate) {
      // we need to do multiple delegations with
      // a different command at each step
      result.multiDelegate.forEach(function (delConfig) {
        // copy command, and then set opts
        commandObject.setOptionsMap(delConfig.options || {});
        commandObject.setGeneralArgs(delConfig.args || []);

        commandConfigs[delConfig.vcs][delConfig.name].execute.call(this, engine, commandObject);
      }, this);
    } else {
      config = commandConfigs[result.vcs][result.name];
      // commandObj is PASSED BY REFERENCE
      // and modified in the function
      commandConfigs[result.vcs][result.name].execute.call(this, engine, commandObject);
    }
  },

  blankMap() {
    return { git: {}, hg: {} };
  },

  getShortcutMap() {
    const map = this.blankMap();
    this.loop((config, name, vcs) => {
      if (!config.sc) {
        return;
      }
      map[vcs][name] = config.sc;
    }, this);
    return map;
  },

  getOptionMap() {
    const optionMap = this.blankMap();
    this.loop((config, name, vcs) => {
      const displayName = config.displayName || name;
      const thisMap = {};
      // start all options off as disabled
      for (const option of (config.options || [])) {
        thisMap[option] = false;
      }
      optionMap[vcs][displayName] = thisMap;
    });
    return optionMap;
  },

  getRegexMap() {
    const map = this.blankMap();
    this.loop((config, name, vcs) => {
      const displayName = config.displayName || name;
      map[vcs][displayName] = config.regex;
    });
    return map;
  },

  /**
   * which commands count for the git golf game
   */
  getCommandsThatCount() {
    const counted = this.blankMap();
    this.loop((config, name, vcs) => {
      if (config.dontCountForGolf) {
        return;
      }
      counted[vcs][name] = config.regex;
    });
    return counted;
  },

  loop(callback, context) {
    for (const vcs of Object.keys(commandConfigs)) {
      const commandConfig = commandConfigs[vcs];
      for (const name of Object.keys(commandConfig)) {
        const config = commandConfig[name];
        callback(config, name, vcs);
      }
    }
  },
};

const parse = function (string) {
  let vcs;
  let method;
  let options;

  // see if we support this particular command
  const regexMap = commands.getRegexMap();
  for (const thisVCS of Object.keys(regexMap)) {
    const map = regexMap[thisVCS];
    for (const thisMethod of Object.keys(map)) {
      const regex = map[thisMethod];
      if (regex.test(string)) {
        vcs = thisVCS;
        method = thisMethod;
        // every valid regex has to have the parts of
        // <vcs> <command> <stuff>
        // because there are always two space-groups
        // before our "stuff" we can simply
        // split on space-groups and grab everything after
        // the second:
        options = string.match(/('.*?'|".*?"|\S+)/g).slice(2);
      }
    }
  }

  if (!method) {
    return false;
  }

  // we support this command!
  // parse off the options and assemble the map / general args
  const parsedOptions = new CommandOptionParser(vcs, method, options);
  const error = parsedOptions.explodeAndSet();
  return {
    toSet: {
      generalArgs: parsedOptions.generalArgs,
      supportedMap: parsedOptions.supportedMap,
      error,
      vcs,
      method,
      options,
      eventName: 'processGitCommand',
    },
  };
};

/**
 * CommandOptionParser
 */
function CommandOptionParser(vcs, method, options) {
  this.vcs = vcs;
  this.method = method;
  this.rawOptions = options;

  this.supportedMap = commands.getOptionMap()[vcs][method];
  if (this.supportedMap === undefined) {
    throw new Error(`No option map for ${method}`);
  }

  this.generalArgs = [];
}

CommandOptionParser.prototype.explodeAndSet = function () {
  for (let index = 0; index < this.rawOptions.length; index++) {
    const part = this.rawOptions[index];

    if (part.slice(0, 1) == '-') {
      // it's an option, check supportedMap
      if (this.supportedMap[part] === undefined) {
        return new CommandProcessError({
          msg: intl.str(
            'option-not-supported',
            { option: part },
          ),
        });
      }

      const next = this.rawOptions[index + 1];
      let optionArguments = [];
      if (next && next.slice(0, 1) !== '-') {
        // only store the next argument as this
        // option value if its not another option
        index++;
        optionArguments = [next];
      }
      this.supportedMap[part] = optionArguments;
    } else {
      // must be a general arg
      this.generalArgs.push(part);
    }
  }
};

exports.commands = commands;
exports.parse = parse;
