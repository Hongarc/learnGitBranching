const Backbone = require('backbone');
const Q = require('q');

const util = require('../util');
const Main = require('../app');
const intl = require('../intl');
const Errors = require('../util/errors');

const { Visualization } = require('../visuals/visualization');
const { ParseWaterfall } = require('./parseWaterfall');
const { Level } = require('.');
const LocaleStore = require('../stores/LocaleStore');
const LevelStore = require('../stores/LevelStore');

const { Command } = require('../models/commandModel');
const { GitShim } = require('../git/gitShim');

const { MultiView } = require('../views/multiView');

const { CanvasTerminalHolder } = require('../views');
const { ConfirmCancelTerminal } = require('../views');
const { NextLevelConfirm } = require('../views');

const { MarkdownPresenter } = require('../views/builderViews');
const { MultiViewBuilder } = require('../views/builderViews');
const { MarkdownGrabber } = require('../views/builderViews');

const regexMap = {
  'define goal': /^define goal$/,
  'define name': /^define name$/,
  'help builder': /^help builder$/,
  'define start': /^define start$/,
  'edit dialog': /^edit dialog$/,
  'show start': /^show start$/,
  'hide start': /^hide start$/,
  'define hint': /^define hint$/,
  finish: /^finish$/,
};

const parse = util.genParseCommand(regexMap, 'processLevelBuilderCommand');

var LevelBuilder = Level.extend({
  initialize(options) {
    options = options || {};
    options.level = {};
    this.options = options;

    const locale = LocaleStore.getLocale();
    options.level.startDialog = {};
    options.level.startDialog[locale] = {
      childViews: intl.getDialog(require('../dialogs/levelBuilder')),
    };

    // if we are editing a level our behavior is a bit different
    let editLevelJSON;
    if (options.editLevel) {
      editLevelJSON = LevelStore.getLevel(options.editLevel);
      options.level = editLevelJSON;
    }

    Reflect.apply(LevelBuilder.__super__.initialize, this, [options]);
    if (!options.editLevel) {
      this.startDialogObj = undefined;
      this.definedGoal = false;
    } else {
      this.startDialogObj = editLevelJSON.startDialog[locale];
      this.definedGoal = true;
    }

    // we won't be using this stuff, and it is deleted to ensure we overwrite all functions that
    // include that functionality
    delete this.treeCompare;
    delete this.solved;
  },

  initName() {},

  initGoalData() {
    // add some default behavior in the beginning if we are not editing
    if (!this.options.editLevel) {
      this.level.goalTreeString = '{"branches":{"master":{"target":"C1","id":"master"},"makeLevel":{"target":"C2","id":"makeLevel"}},"commits":{"C0":{"parents":[],"id":"C0","rootCommit":true},"C1":{"parents":["C0"],"id":"C1"},"C2":{"parents":["C1"],"id":"C2"}},"HEAD":{"target":"makeLevel","id":"HEAD"}}';
      this.level.solutionCommand = 'git checkout -b makeLevel; git commit';
    }
    Reflect.apply(LevelBuilder.__super__.initGoalData, this, arguments);
  },

  /**
   * need custom handlers since we have two visualizations >___<
   */
  minimizeGoal(position, size) {
    this.doBothVis('hide');
    this.goalWindowPos = position;
    this.goalWindowSize = size;
    if ($('#goalPlaceholder').is(':visible')) {
      $('#goalPlaceholder').hide();
      this.mainVis.myResize();
    }
  },

  doBothVis(method) {
    if (this.startVis) {
      this.startVis[method].call(this.startVis);
    }
    if (this.goalVis) {
      this.goalVis[method].call(this.goalVis);
    }
  },

  resizeGoal() {
    this.doBothVis('myResize');
  },

  initStartVisualization() {
    this.startCanvasHolder = new CanvasTerminalHolder({
      parent: this,
      additionalClass: 'startTree',
      text: intl.str('hide-start'),
    });

    this.startVis = new Visualization({
      el: this.startCanvasHolder.getCanvasLocation(),
      containerElement: this.startCanvasHolder.getCanvasLocation(),
      treeString: this.level.startTree,
      noKeyboardInput: true,
      smallCanvas: true,
      noClick: true,
    });
    return this.startCanvasHolder;
  },

  startOffCommand() {
    Main.getEventBaton().trigger(
      'commandSubmitted',
      'echo :D',
    );
  },

  objectiveDialog(command, deferred) {
    const arguments_ = [
      command,
      deferred,
      (this.startDialogObj === undefined)
        ? null
        : {
          startDialog: {
            en_US: this.startDialogObj,
          },
        },
    ];
    LevelBuilder.__super__.objectiveDialog.apply(this, arguments_);
  },

  initParseWaterfall(options) {
    Reflect.apply(LevelBuilder.__super__.initParseWaterfall, this, [options]);

    this.parseWaterfall.addFirst(
      'parseWaterfall',
      parse,
    );
    this.parseWaterfall.addFirst(
      'instantWaterfall',
      this.getInstantCommands(),
    );
  },

  buildLevel(command, deferred) {
    this.exitLevel();

    setTimeout(() => {
      Main.getSandbox().buildLevel(command, deferred);
    }, this.getAnimationTime() * 1.5);
  },

  getInstantCommands() {
    return [
      [/^help$|^\?$/, function () {
        throw new Errors.CommandResult({
          msg: intl.str('help-vague-builder'),
        });
      }],
    ];
  },

  takeControl() {
    Main.getEventBaton().stealBaton('processLevelBuilderCommand', this.processLevelBuilderCommand, this);

    LevelBuilder.__super__.takeControl.apply(this);
  },

  releaseControl() {
    Main.getEventBaton().releaseBaton('processLevelBuilderCommand', this.processLevelBuilderCommand, this);

    LevelBuilder.__super__.releaseControl.apply(this);
  },

  showGoal() {
    this.hideStart();
    Reflect.apply(LevelBuilder.__super__.showGoal, this, arguments);
  },

  showStart(command, deferred) {
    this.hideGoal();
    this.showSideVis(command, deferred, this.startCanvasHolder, this.initStartVisualization);
  },

  resetSolution() {
    this.gitCommandsIssued = [];
    this.level.solutionCommand = undefined;
  },

  hideStart(command, deferred) {
    this.hideSideVis(command, deferred, this.startCanvasHolder);
  },

  defineStart(command, deferred) {
    this.hideStart();

    command.addWarning(intl.str('define-start-warning'));
    this.resetSolution();

    this.level.startTree = this.mainVis.gitEngine.printTree();
    this.mainVis.resetFromThisTreeNow(this.level.startTree);

    this.showStart(command, deferred);
  },

  defineGoal(command, deferred) {
    this.hideGoal();

    if (this.gitCommandsIssued.length === 0) {
      command.set('error', new Errors.GitError({
        msg: intl.str('solution-empty'),
      }));
      deferred.resolve();
      return;
    }

    this.definedGoal = true;
    this.level.solutionCommand = this.gitCommandsIssued.join(';');
    this.level.goalTreeString = this.mainVis.gitEngine.printTree();
    this.initGoalVisualization();

    this.showGoal(command, deferred);
  },

  defineName(command, deferred) {
    this.level.name = {
      en_US: prompt(intl.str('prompt-name')),
    };

    if (command) { command.finishWith(deferred); }
  },

  defineHint(command, deferred) {
    this.level.hint = {
      en_US: prompt(intl.str('prompt-hint')),
    };
    if (command) { command.finishWith(deferred); }
  },

  editDialog(command, deferred) {
    const whenDoneEditing = Q.defer();
    this.currentBuilder = new MultiViewBuilder({
      multiViewJSON: this.startDialogObj,
      deferred: whenDoneEditing,
    });
    whenDoneEditing.promise
      .then((levelObject) => {
        this.startDialogObj = levelObject;
      })
      .fail(() => {
      // nothing to do, they don't want to edit it apparently
      })
      .done(() => {
        if (command) {
          command.finishWith(deferred);
        } else {
          deferred.resolve();
        }
      });
  },

  finish(command, deferred) {
    if (!this.options.editLevel && (this.gitCommandsIssued.length === 0 || !this.definedGoal)) {
      command.set('error', new Errors.GitError({
        msg: intl.str('solution-empty'),
      }));
      deferred.resolve();
      return;
    }

    while (!this.level.name) {
      this.defineName();
    }

    const masterDeferred = Q.defer();
    let chain = masterDeferred.promise;

    if (this.level.hint === undefined) {
      const askForHintDeferred = Q.defer();
      chain = chain.then(() => askForHintDeferred.promise);

      // ask for a hint if there is none
      const askForHintView = new ConfirmCancelTerminal({
        markdowns: [
          intl.str('want-hint'),
        ],
      });
      askForHintView.getPromise()
        .then(this.defineHint.bind(this))
        .fail(() => {
          this.level.hint = { en_US: '' };
        })
        .done(() => {
          askForHintDeferred.resolve();
        });
    }

    if (this.startDialogObj === undefined) {
      const askForStartDeferred = Q.defer();
      chain = chain.then(() => askForStartDeferred.promise);

      const askForStartView = new ConfirmCancelTerminal({
        markdowns: [
          intl.str('want-start-dialog'),
        ],
      });
      askForStartView.getPromise()
        .then(() => {
        // oh boy this is complex
          const whenEditedDialog = Q.defer();
          // the undefined here is the command that doesn't need resolving just yet...
          this.editDialog(undefined, whenEditedDialog);
          return whenEditedDialog.promise;
        })
        .fail(() => {
        // if they don't want to edit the start dialog, do nothing
        })
        .done(() => {
          askForStartDeferred.resolve();
        });
    }

    chain = chain.done(() => {
      // ok great! lets just give them the goods
      new MarkdownPresenter({
        fillerText: JSON.stringify(this.getExportObj(), null, 2),
        previewText: intl.str('share-json'),
      });
      command.finishWith(deferred);
    });

    masterDeferred.resolve();
  },

  getExportObj() {
    const compiledLevel = {

      ...this.level,
    };
    // the start dialog now is just our help intro thing
    delete compiledLevel.startDialog;
    if (this.startDialogObj) {
      compiledLevel.startDialog = { en_US: this.startDialogObj };
    }
    return compiledLevel;
  },

  processLevelBuilderCommand(command, deferred) {
    const methodMap = {
      'define goal': this.defineGoal,
      'define start': this.defineStart,
      'show start': this.showStart,
      'hide start': this.hideStart,
      finish: this.finish,
      'define hint': this.defineHint,
      'define name': this.defineName,
      'edit dialog': this.editDialog,
      'help builder': LevelBuilder.__super__.startDialog,
    };
    if (!methodMap[command.get('method')]) {
      throw new Error("woah we don't support that method yet");
    }

    Reflect.apply(methodMap[command.get('method')], this, arguments);
  },

  afterCommandDefer(defer, command) {
    // we don't need to compare against the goal anymore
    defer.resolve();
  },

  die() {
    this.hideStart();
    Reflect.apply(LevelBuilder.__super__.die, this, arguments);

    delete this.startVis;
    delete this.startCanvasHolder;
  },
});

exports.LevelBuilder = LevelBuilder;
exports.regexMap = regexMap;
