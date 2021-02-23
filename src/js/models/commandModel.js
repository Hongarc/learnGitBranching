const Backbone = require('backbone');

const Errors = require('../util/errors');

const { ParseWaterfall } = require('../level/parseWaterfall');
const LevelStore = require('../stores/LevelStore');
const intl = require('../intl');

const { CommandProcessError } = Errors;
const { GitError } = Errors;
const { Warning } = Errors;
const { CommandResult } = Errors;

const Command = Backbone.Model.extend({
  defaults: {
    status: 'inqueue',
    rawStr: null,
    result: '',
    createTime: null,

    error: null,
    warnings: null,
    parseWaterfall: new ParseWaterfall(),

    generalArgs: null,
    supportedMap: null,
    options: null,
    method: null,

  },

  initialize() {
    this.initDefaults();
    this.validateAtInit();

    this.on('change:error', this.errorChanged, this);
    // catch errors on init
    if (this.get('error')) {
      this.errorChanged();
    }

    this.parseOrCatch();
  },

  initDefaults() {
    // weird things happen with defaults if you don't
    // make new objects
    this.set('generalArgs', []);
    this.set('supportedMap', {});
    this.set('warnings', []);
  },

  replaceDotWithHead(string) {
    return string.replace(/\./g, 'HEAD');
  },

  /**
   * Since mercurial always wants revisions with
   * -r, we want to just make these general
   * args for git
   */
  appendOptionR() {
    const rOptions = this.getOptionsMap()['-r'] || [];
    this.setGeneralArgs(
      this.getGeneralArgs().concat(rOptions),
    );
  },

  // if order is important
  prependOptionR() {
    const rOptions = this.getOptionsMap()['-r'] || [];
    this.setGeneralArgs(
      rOptions.concat(this.getGeneralArgs()),
    );
  },

  mapDotToHead() {
    let generalArguments = this.getGeneralArgs();
    const options = this.getOptionsMap();

    generalArguments = generalArguments.map(function (argument) {
      return this.replaceDotWithHead(argument);
    }, this);
    const newMap = {};
    Object.keys(options).forEach(function (key) {
      const arguments_ = options[key];
      newMap[key] = Object.values(arguments_).map(function (argument) {
        return this.replaceDotWithHead(argument);
      }, this);
    }, this);
    this.setGeneralArgs(generalArguments);
    this.setOptionsMap(newMap);
  },

  deleteOptions(options) {
    const map = this.getOptionsMap();
    options.forEach((option) => {
      delete map[option];
    }, this);
    this.setOptionsMap(map);
  },

  getGeneralArgs() {
    return this.get('generalArgs');
  },

  setGeneralArgs(arguments_) {
    this.set('generalArgs', arguments_);
  },

  setOptionsMap(map) {
    this.set('supportedMap', map);
  },

  getOptionsMap() {
    return this.get('supportedMap');
  },

  acceptNoGeneralArgs() {
    if (this.getGeneralArgs().length > 0) {
      throw new GitError({
        msg: intl.str('git-error-no-general-args'),
      });
    }
  },

  oneArgImpliedHead(arguments_, option) {
    this.validateArgBounds(arguments_, 0, 1, option);
    // and if it's one, add a HEAD to the back
    this.impliedHead(arguments_, 0);
  },

  twoArgsImpliedHead(arguments_, option) {
    // our args we expect to be between 1 and 2
    this.validateArgBounds(arguments_, 1, 2, option);
    // and if it's one, add a HEAD to the back
    this.impliedHead(arguments_, 1);
  },

  oneArgImpliedOrigin(arguments_) {
    this.validateArgBounds(arguments_, 0, 1);
    if (arguments_.length === 0) {
      arguments_.unshift('origin');
    }
  },

  twoArgsForOrigin(arguments_) {
    this.validateArgBounds(arguments_, 0, 2);
  },

  impliedHead(arguments_, min) {
    if (arguments_.length == min) {
      arguments_.push('HEAD');
    }
  },

  // this is a little utility class to help arg validation that happens over and over again
  validateArgBounds(arguments_, lower, upper, option) {
    let what = (option === undefined)
      ? `git ${this.get('method')}`
      : `${this.get('method')} ${option} `;
    what = `with ${what}`;

    if (arguments_.length < lower) {
      throw new GitError({
        msg: intl.str(
          'git-error-args-few',
          {
            lower: String(lower),
            what,
          },
        ),
      });
    }
    if (arguments_.length > upper) {
      throw new GitError({
        msg: intl.str(
          'git-error-args-many',
          {
            upper: String(upper),
            what,
          },
        ),
      });
    }
  },

  validateAtInit() {
    if (this.get('rawStr') === null) {
      throw new Error('Give me a string!');
    }
    if (!this.get('createTime')) {
      this.set('createTime', new Date().toString());
    }
  },

  setResult(message) {
    this.set('result', message);
  },

  finishWith(deferred) {
    this.set('status', 'finished');
    deferred.resolve();
  },

  addWarning(message) {
    this.get('warnings').push(message);
    // change numWarnings so the change event fires. This is bizarre -- Backbone can't
    // detect if an array changes, so adding an element does nothing
    this.set('numWarnings', this.get('numWarnings') ? this.get('numWarnings') + 1 : 1);
  },

  parseOrCatch() {
    this.expandShortcuts(this.get('rawStr'));
    try {
      this.processInstants();
    } catch (error) {
      Errors.filterError(error);
      // errorChanged() will handle status and all of that
      this.set('error', error);
      return;
    }

    if (this.parseAll()) {
      // something in our parse waterfall succeeded
      return;
    }

    // if we reach here, this command is not supported :-/
    this.set('error', new CommandProcessError({
      msg: intl.str(
        'git-error-command-not-supported',
        {
          command: this.get('rawStr'),
        },
      ),
    }));
  },

  errorChanged() {
    const error = this.get('error');
    if (!error) { return; }
    if (error instanceof CommandProcessError
        || error instanceof GitError) {
      this.set('status', 'error');
    } else if (error instanceof CommandResult) {
      this.set('status', 'finished');
    } else if (error instanceof Warning) {
      this.set('status', 'warning');
    }
    this.formatError();
  },

  formatError() {
    this.set('result', this.get('error').getMsg());
  },

  expandShortcuts(string) {
    string = this.get('parseWaterfall').expandAllShortcuts(string);
    this.set('rawStr', string);
  },

  processInstants() {
    const string = this.get('rawStr');
    // first if the string is empty, they just want a blank line
    if (string.length === 0) {
      throw new CommandResult({ msg: '' });
    }

    // then instant commands that will throw
    this.get('parseWaterfall').processAllInstants(string);
  },

  parseAll() {
    let rawInput = this.get('rawStr');
    const aliasMap = LevelStore.getAliasMap();
    for (let index = 0; index < Object.keys(aliasMap).length; index++) {
      const alias = Object.keys(aliasMap)[index];
      const searcher = new RegExp(`${alias}(\\s|$)`, 'g');
      if (searcher.test(rawInput)) {
        rawInput = rawInput.replace(searcher, `${aliasMap[alias]} `);
        break;
      }
    }

    const results = this.get('parseWaterfall').parseAll(rawInput);

    if (!results) {
      // nothing parsed successfully
      return false;
    }

    Object.keys(results.toSet).forEach(function (key) {
      const object = results.toSet[key];
      // data comes back from the parsing functions like
      // options (etc) that need to be set
      this.set(key, object);
    }, this);
    return true;
  },
});

exports.Command = Command;
