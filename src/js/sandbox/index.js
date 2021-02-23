const Q = require('q');
const Backbone = require('backbone');

const util = require('../util');
const intl = require('../intl');
const Main = require('../app');
const Errors = require('../util/errors');

const { Visualization } = require('../visuals/visualization');
const { ParseWaterfall } = require('../level/parseWaterfall');
const { DisabledMap } = require('../level/disabledMap');
const { Command } = require('../models/commandModel');
const { GitShim } = require('../git/gitShim');
const LevelActions = require('../actions/LevelActions');
const LevelStore = require('../stores/LevelStore');

const Views = require('../views');

const { ModalTerminal } = Views;
const { ModalAlert } = Views;
const BuilderViews = require('../views/builderViews');
const { MultiView } = require('../views/multiView');

const Sandbox = Backbone.View.extend({
  // tag name here is purely vestigial. I made this a view
  // simply to use inheritance and have a nice event system in place
  tagName: 'div',
  initialize(options) {
    options = options || {};
    this.options = options;

    this.initVisualization(options);
    this.initCommandCollection(options);
    this.initParseWaterfall(options);
    this.initGitShim(options);
    this.initUndoStack(options);

    if (!options.wait) {
      this.takeControl();
    }
  },

  getDefaultVisEl() {
    return $('#mainVisSpace')[0];
  },

  getAnimationTime() { return 700 * 1.5; },

  initVisualization(options) {
    this.mainVis = new Visualization({
      el: options.el || this.getDefaultVisEl(),
    });
  },

  initUndoStack(options) {
    this.undoStack = [];
  },

  initCommandCollection(options) {
    // don't add it to just any collection -- adding to the
    // CommandUI collection will put in history
    this.commandCollection = Main.getCommandUI().commandCollection;
  },

  initParseWaterfall(options) {
    this.parseWaterfall = new ParseWaterfall();
  },

  initGitShim(options) {
    this.gitShim = new GitShim({
      beforeCB: this.beforeCommandCB.bind(this),
    });
  },

  takeControl() {
    // we will be handling commands that are submitted, mainly to add the sandbox
    // functionality (which is included by default in ParseWaterfall())
    Main.getEventBaton().stealBaton('commandSubmitted', this.commandSubmitted, this);
    // we obviously take care of sandbox commands
    Main.getEventBaton().stealBaton('processSandboxCommand', this.processSandboxCommand, this);

    // a few things to help transition between levels and sandbox
    Main.getEventBaton().stealBaton('levelExited', this.levelExited, this);

    this.insertGitShim();
  },

  releaseControl() {
    // we will be handling commands that are submitted, mainly to add the sanadbox
    // functionality (which is included by default in ParseWaterfall())
    Main.getEventBaton().releaseBaton('commandSubmitted', this.commandSubmitted, this);
    // we obviously take care of sandbox commands
    Main.getEventBaton().releaseBaton('processSandboxCommand', this.processSandboxCommand, this);
    // a few things to help transition between levels and sandbox
    Main.getEventBaton().releaseBaton('levelExited', this.levelExited, this);

    this.releaseGitShim();
  },

  releaseGitShim() {
    if (this.gitShim) {
      this.gitShim.removeShim();
    }
  },

  insertGitShim() {
    // and our git shim goes in after the git engine is ready so it doesn't steal the baton
    // too early
    if (this.gitShim) {
      this.mainVis.customEvents.on('gitEngineReady', function () {
        this.gitShim.insertShim();
      }, this);
    }
  },

  beforeCommandCB(command) {
    this.pushUndo();
  },

  pushUndo() {
    // go ahead and push the three onto the stack
    this.undoStack.push(this.mainVis.gitEngine.printTree());
  },

  undo(command, deferred) {
    const toRestore = this.undoStack.pop();
    if (!toRestore) {
      command.set('error', new Errors.GitError({
        msg: intl.str('undo-stack-empty'),
      }));
      deferred.resolve();
      return;
    }

    this.mainVis.reset(toRestore);
    setTimeout(() => {
      command.finishWith(deferred);
    }, this.mainVis.getAnimationTime());
  },

  commandSubmitted(value) {
    // allow other things to see this command (aka command history on terminal)
    Main.getEvents().trigger('commandSubmittedPassive', value);

    util.splitTextCommand(value, function (command) {
      this.commandCollection.add(new Command({
        rawStr: command,
        parseWaterfall: this.parseWaterfall,
      }));
    }, this);
  },

  startLevel(command, deferred) {
    const regexResults = command.get('regexResults') || [];
    const desiredID = regexResults[1] || '';
    const levelJSON = LevelStore.getLevel(desiredID);

    // handle the case where that level is not found...
    if (!levelJSON) {
      command.addWarning(
        intl.str(
          'level-no-id',
          { id: desiredID },
        ),
      );
      Main.getEventBaton().trigger('commandSubmitted', 'levels');

      command.set('status', 'error');
      deferred.resolve();
      return;
    }

    // we are good to go!! lets prep a bit visually
    this.hide();
    this.clear();

    // we don't even need a reference to this,
    // everything will be handled via event baton :DDDDDDDDD
    const whenLevelOpen = Q.defer();
    const { Level } = require('../level');

    this.currentLevel = new Level({
      level: levelJSON,
      deferred: whenLevelOpen,
      command,
    });

    whenLevelOpen.promise.then(() => {
      command.finishWith(deferred);
    });
  },

  buildLevel(command, deferred) {
    this.hide();
    this.clear();

    const whenBuilderOpen = Q.defer();
    const { LevelBuilder } = require('../level/builder');

    const regexResults = command.get('regexResults') || [];
    const toEdit = regexResults[1] || false;
    this.levelBuilder = new LevelBuilder({
      deferred: whenBuilderOpen,
      editLevel: toEdit,
    });
    whenBuilderOpen.promise.then(() => {
      command.finishWith(deferred);
    });
  },

  exitLevel(command, deferred) {
    command.addWarning(
      intl.str('level-cant-exit'),
    );
    command.set('status', 'error');
    deferred.resolve();
  },

  showLevels(command, deferred) {
    const whenClosed = Q.defer();
    Main.getLevelDropdown().show(whenClosed, command);
    whenClosed.promise.done(() => {
      command.finishWith(deferred);
    });
  },

  sharePermalink(command, deferred) {
    const treeJSON = JSON.stringify(this.mainVis.gitEngine.exportTree());
    const url = `https://learngitbranching.js.org/?NODEMO&command=importTreeNow%20${escape(treeJSON)}`;
    command.setResult(
      `${intl.todo('Here is a link to the current state of the tree: ')}\n${url}`,
    );
    command.finishWith(deferred);
  },

  resetSolved(command, deferred) {
    if (command.get('regexResults').input !== 'reset solved --confirm') {
      command.set('error', new Errors.GitError({
        msg: 'Reset solved will mark each level as not yet solved; because '
             + 'this is a destructive command, please pass in --confirm to execute',
      }));
      command.finishWith(deferred);
      return;
    }

    LevelActions.resetLevelsSolved();
    command.addWarning(
      intl.str('solved-map-reset'),
    );
    command.finishWith(deferred);
  },

  processSandboxCommand(command, deferred) {
    // I'm tempted to do cancel case conversion, but there are
    // some exceptions to the rule
    const commandMap = {
      'reset solved': this.resetSolved,
      undo: this.undo,
      'help general': this.helpDialog,
      help: this.helpDialog,
      reset: this.reset,
      delay: this.delay,
      clear: this.clear,
      'exit level': this.exitLevel,
      level: this.startLevel,
      sandbox: this.exitLevel,
      levels: this.showLevels,
      mobileAlert: this.mobileAlert,
      'build level': this.buildLevel,
      'export tree': this.exportTree,
      'import tree': this.importTree,
      importTreeNow: this.importTreeNow,
      'import level': this.importLevel,
      importLevelNow: this.importLevelNow,
      'share permalink': this.sharePermalink,
    };

    const method = commandMap[command.get('method')];
    if (!method) { throw new Error('no method for that wut'); }

    Reflect.apply(method, this, [command, deferred]);
  },

  hide() {
    this.mainVis.hide();
  },

  levelExited() {
    this.show();
  },

  show() {
    this.mainVis.show();
  },

  importLevelNow(command, deferred) {
    const options = command.get('regexResults') || [];
    if (options.length < 2) {
      command.set('error', new Errors.GitError({
        msg: intl.str('git-error-options'),
      }));
      command.finishWith(deferred);
      return;
    }
    const string = options.input.replace(/importLevelNow\s+/g, '');
    const { Level } = require('../level');
    try {
      const levelJSON = JSON.parse(unescape(string));
      const whenLevelOpen = Q.defer();
      this.currentLevel = new Level({
        level: levelJSON,
        deferred: whenLevelOpen,
        command,
      });
      this.hide();

      whenLevelOpen.promise.then(() => {
        command.finishWith(deferred);
      });
    } catch (error) {
      command.set('error', new Errors.GitError({
        msg: `Something went wrong ${String(error)}`,
      }));
      throw error;
    }
    command.finishWith(deferred);
  },

  importTreeNow(command, deferred) {
    const options = command.get('regexResults') || [];
    if (options.length < 2) {
      command.set('error', new Errors.GitError({
        msg: intl.str('git-error-options'),
      }));
      command.finishWith(deferred);
    }
    const string = options.input.replace(/importTreeNow\s+/g, '');
    try {
      this.mainVis.gitEngine.loadTreeFromString(string);
    } catch (error) {
      command.set('error', new Errors.GitError({
        msg: String(error),
      }));
    }
    command.finishWith(deferred);
  },

  importTree(command, deferred) {
    const jsonGrabber = new BuilderViews.MarkdownPresenter({
      previewText: intl.str('paste-json'),
      fillerText: ' ',
    });
    jsonGrabber.deferred.promise
      .then((treeJSON) => {
        try {
          this.mainVis.gitEngine.loadTree(JSON.parse(treeJSON));
        } catch (error) {
          this.mainVis.reset();
          new MultiView({
            childViews: [{
              type: 'ModalAlert',
              options: {
                markdowns: [
                  '## Error!',
                  '',
                  'Something is wrong with that JSON! Here is the error:',
                  '',
                  String(error),
                ],
              },
            }],
          });
        }
      })
      .fail(() => {})
      .done(() => {
        command.finishWith(deferred);
      });
  },

  importLevel(command, deferred) {
    const jsonGrabber = new BuilderViews.MarkdownPresenter({
      previewText: intl.str('paste-json'),
      fillerText: ' ',
    });

    jsonGrabber.deferred.promise
      .then((inputText) => {
        const { Level } = require('../level');
        try {
          const levelJSON = JSON.parse(inputText);
          const whenLevelOpen = Q.defer();
          this.currentLevel = new Level({
            level: levelJSON,
            deferred: whenLevelOpen,
            command,
          });
          this.hide();

          whenLevelOpen.promise.then(() => {
            command.finishWith(deferred);
          });
        } catch (error) {
          new MultiView({
            childViews: [{
              type: 'ModalAlert',
              options: {
                markdowns: [
                  '## Error!',
                  '',
                  'Something is wrong with that level JSON, this happened:',
                  '',
                  String(error),
                ],
              },
            }],
          });
          command.finishWith(deferred);
        }
      })
      .fail(() => {
        command.finishWith(deferred);
      })
      .done();
  },

  exportTree(command, deferred) {
    const treeJSON = JSON.stringify(this.mainVis.gitEngine.exportTree(), null, 2);

    const showJSON = new MultiView({
      childViews: [{
        type: 'MarkdownPresenter',
        options: {
          previewText: intl.str('share-tree'),
          fillerText: treeJSON,
          noConfirmCancel: true,
        },
      }],
    });
    showJSON.getPromise()
      .then(() => {
        command.finishWith(deferred);
      })
      .done();
  },

  clear(command, deferred) {
    Main.getEvents().trigger('clearOldCommands');
    if (command && deferred) {
      command.finishWith(deferred);
    }
  },

  mobileAlert(command, deferred) {
    alert(intl.str('mobile-alert'));
    command.finishWith(deferred);
  },

  delay(command, deferred) {
    const amount = Number.parseInt(command.get('regexResults')[1], 10);
    setTimeout(() => {
      command.finishWith(deferred);
    }, amount);
  },

  reset(command, deferred) {
    this.mainVis.reset();
    this.initUndoStack();

    setTimeout(() => {
      command.finishWith(deferred);
    }, this.mainVis.getAnimationTime());
  },

  helpDialog(command, deferred) {
    const helpDialog = new MultiView({
      childViews: intl.getDialog(require('../dialogs/sandbox')),
    });
    helpDialog.getPromise().then(() => {
      // the view has been closed, lets go ahead and resolve our command
      command.finishWith(deferred);
    })
      .done();
  },
});

exports.Sandbox = Sandbox;
