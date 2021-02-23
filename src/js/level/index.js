const Q = require('q');
const React = require('react');
const ReactDOM = require('react-dom');

const util = require('../util');
const Main = require('../app');
const intl = require('../intl');
const log = require('../log');

const Errors = require('../util/errors');
const { Sandbox } = require('../sandbox');
const GlobalStateActions = require('../actions/GlobalStateActions');
const GlobalStateStore = require('../stores/GlobalStateStore');
const LevelActions = require('../actions/LevelActions');
const LevelStore = require('../stores/LevelStore');
const { Visualization } = require('../visuals/visualization');
const { DisabledMap } = require('./disabledMap');
const { GitShim } = require('../git/gitShim');
const Commands = require('../commands');

const { MultiView } = require('../views/multiView');
const { CanvasTerminalHolder } = require('../views');
const { ConfirmCancelTerminal } = require('../views');
const { NextLevelConfirm } = require('../views');
const LevelToolbarView = require('../react_views/LevelToolbarView.jsx');

const TreeCompare = require('../graph/treeCompare');

const regexMap = {
  'help level': /^help level$/,
  'start dialog': /^start dialog$/,
  'show goal': /^(show goal|goal|help goal)$/,
  'hide goal': /^hide goal$/,
  'show solution': /^show solution($|\s)/,
  objective: /^(objective|assignment)$/,
};

const parse = util.genParseCommand(regexMap, 'processLevelCommand');

const Level = Sandbox.extend({
  initialize(options = {}) {
    const level = options.level || {};

    this.level = level;

    this.gitCommandsIssued = [];
    this.solved = false;
    this.wasResetAfterSolved = false;

    this.initGoalData(options);
    this.initName(options);
    this.on('minimizeCanvas', this.minimizeGoal);
    this.on('resizeCanvas', this.resizeGoal);
    this.isGoalExpanded = false;

    Reflect.apply(Level.__super__.initialize, this, [options]);
    this.startOffCommand();

    this.handleOpen(options.deferred);
  },

  getIsGoalExpanded() {
    return this.isGoalExpanded;
  },

  handleOpen(deferred = Q.defer()) {
    // if there is a multiview in the beginning, open that
    // and let it resolve our deferred
    if (GlobalStateStore.getShouldDisableLevelInstructions()) {
      setTimeout(() => {
        deferred.resolve();
      }, 100);
      return;
    }

    if (this.level.startDialog && !this.testOption('noIntroDialog')) {
      new MultiView({
        ...intl.getStartDialog(this.level),
        deferred,
      });
      return;
    }

    // otherwise, resolve after a 700 second delay to allow
    // for us to animate easily
    setTimeout(() => {
      deferred.resolve();
    }, this.getAnimationTime() * 1.2);
  },

  objectiveDialog(command, deferred, levelObject) {
    levelObject = (levelObject === undefined) ? this.level : levelObject;

    if (!levelObject || !levelObject.startDialog) {
      command.set('error', new Errors.GitError({
        msg: intl.str('no-start-dialog'),
      }));
      deferred.resolve();
      return;
    }

    const dialog = $.extend({}, intl.getStartDialog(levelObject));
    // grab the last slide only
    dialog.childViews = dialog.childViews.slice(-1);
    new MultiView(Object.assign(
      dialog,
      { deferred },
    ));

    // when its closed we are done
    deferred.promise.then(() => {
      command.set('status', 'finished');
    });
  },

  startDialog(command, deferred) {
    if (!this.level.startDialog) {
      command.set('error', new Errors.GitError({
        msg: intl.str('no-start-dialog'),
      }));
      deferred.resolve();
      return;
    }

    this.handleOpen(deferred);
    deferred.promise.then(() => {
      command.set('status', 'finished');
    });
  },

  getEnglishName() {
    return this.level.name.en_US;
  },

  initName() {
    const name = intl.getName(this.level);
    this.levelToolbar = React.createElement(
      LevelToolbarView,
      {
        name,
        onGoalClick: this.toggleGoal.bind(this),
        onObjectiveClick: this.toggleObjective.bind(this),
        parent: this,
      },
    );
    ReactDOM.render(
      this.levelToolbar,
      document.querySelector('#levelToolbarMount'),
    );
  },

  initGoalData(options) {
    if (!this.level.goalTreeString || !this.level.solutionCommand) {
      throw new Error('need goal tree and solution');
    }
  },

  takeControl() {
    Main.getEventBaton().stealBaton('processLevelCommand', this.processLevelCommand, this);

    Level.__super__.takeControl.apply(this);
  },

  releaseControl() {
    Main.getEventBaton().releaseBaton('processLevelCommand', this.processLevelCommand, this);

    Level.__super__.releaseControl.apply(this);
  },

  startOffCommand() {
    const method = this.options.command.get('method');
    if (GlobalStateStore.getShouldDisableLevelInstructions()) {
      Main.getEventBaton().trigger(
        'commandSubmitted',
        'hint; show goal',
      );
      return;
    }

    if (!this.testOption('noStartCommand') && method !== 'importLevelNow') {
      Main.getEventBaton().trigger(
        'commandSubmitted',
        'hint; delay 2000; show goal',
      );
    }
  },

  initVisualization(options) {
    this.mainVis = new Visualization({
      el: options.el || this.getDefaultVisEl(),
      treeString: options.level.startTree,
    });
  },

  initGoalVisualization() {
    const onlyMaster = TreeCompare.onlyMasterCompared(this.level);
    // first we make the goal visualization holder
    this.goalCanvasHolder = new CanvasTerminalHolder({
      text: (onlyMaster) ? intl.str('goal-only-main') : undefined,
      parent: this,
    });

    // then we make a visualization. the "el" here is the element to
    // track for size information. the container is where the canvas will be placed
    this.goalVis = new Visualization({
      el: this.goalCanvasHolder.getCanvasLocation(),
      containerElement: this.goalCanvasHolder.getCanvasLocation(),
      treeString: this.level.goalTreeString,
      noKeyboardInput: true,
      smallCanvas: true,
      isGoalVis: true,
      levelBlob: this.level,
      noClick: true,
    });

    // If the goal visualization gets dragged to the right side of the screen, then squeeze the main
    // repo visualization a bit to make room. This way, you could have the goal window hang out on
    // the right side of the screen and still see the repo visualization.
    this.goalVis.customEvents.on('drag', (event, ui) => {
      if (ui.position.left > 0.5 * $(window).width()) {
        if (!$('#goalPlaceholder').is(':visible')) {
          $('#goalPlaceholder').show();
          this.mainVis.myResize();
        }
      } else if ($('#goalPlaceholder').is(':visible')) {
        $('#goalPlaceholder').hide();
        this.mainVis.myResize();
      }
    });

    return this.goalCanvasHolder;
  },

  minimizeGoal(position, size) {
    this.isGoalExpanded = false;
    this.trigger('goalToggled');
    this.goalVis.hide();
    this.goalWindowPos = position;
    this.goalWindowSize = size;
    if ($('#goalPlaceholder').is(':visible')) {
      $('#goalPlaceholder').hide();
      this.mainVis.myResize();
    }
  },

  resizeGoal() {
    if (!this.goalVis) {
      return;
    }
    this.goalVis.myResize();
  },

  showSolution(command, deferred) {
    let toIssue = this.level.solutionCommand;
    const issueFunction = function () {
      this.isShowingSolution = true;
      Main.getEventBaton().trigger(
        'commandSubmitted',
        toIssue,
      );
      log.showLevelSolution(this.getEnglishName());
    }.bind(this);

    const commandString = command.get('rawStr');
    if (!this.testOptionOnString(commandString, 'noReset')) {
      toIssue = `reset --forSolution; ${toIssue}`;
    }
    if (this.testOptionOnString(commandString, 'force')) {
      issueFunction();
      command.finishWith(deferred);
      return;
    }

    // allow them for force the solution
    const confirmDefer = Q.defer();
    const dialog = intl.getDialog(require('../dialogs/confirmShowSolution'))[0];
    const confirmView = new ConfirmCancelTerminal({
      markdowns: dialog.options.markdowns,
      deferred: confirmDefer,
    });

    confirmDefer.promise
      .then(issueFunction)
      .fail(() => {
        command.setResult('');
      })
      .done(() => {
        // either way we animate, so both options can share this logic
        setTimeout(() => {
          command.finishWith(deferred);
        }, confirmView.getAnimationTime());
      });
  },

  toggleObjective() {
    Main.getEventBaton().trigger(
      'commandSubmitted',
      'objective',
    );
  },

  toggleGoal() {
    if (this.goalCanvasHolder && this.goalCanvasHolder.inDom) {
      this.hideGoal();
    } else {
      this.showGoal();
    }
  },

  showGoal(command, defer) {
    this.isGoalExpanded = true;
    this.trigger('goalToggled');
    this.showSideVis(command, defer, this.goalCanvasHolder, this.initGoalVisualization);
    // show the squeezer again we are to the side
    if ($(this.goalVis.el).offset().left > 0.5 * $(window).width()) {
      $('#goalPlaceholder').show();
      this.mainVis.myResize();
    }
  },

  showSideVis(command, defer, canvasHolder, initMethod) {
    const safeFinish = function () {
      if (command) { command.finishWith(defer); }
    };
    if (!canvasHolder || !canvasHolder.inDom) {
      canvasHolder = initMethod.apply(this);
    }

    canvasHolder.restore(this.goalWindowPos, this.goalWindowSize);
    setTimeout(safeFinish, canvasHolder.getAnimationTime());
  },

  hideGoal(command, defer) {
    this.isGoalExpanded = false;
    this.trigger('goalToggled');
    this.hideSideVis(command, defer, this.goalCanvasHolder);
  },

  hideSideVis(command, defer, canvasHolder, vis) {
    const safeFinish = function () {
      if (command) { command.finishWith(defer); }
    };

    if (canvasHolder && canvasHolder.inDom) {
      canvasHolder.die();
      setTimeout(safeFinish, canvasHolder.getAnimationTime());
    } else {
      safeFinish();
    }
  },

  initParseWaterfall(options) {
    Reflect.apply(Level.__super__.initParseWaterfall, this, [options]);

    // add our specific functionality
    this.parseWaterfall.addFirst(
      'parseWaterfall',
      parse,
    );

    this.parseWaterfall.addFirst(
      'instantWaterfall',
      this.getInstantCommands(),
    );

    // if we want to disable certain commands...
    if (options.level.disabledMap) {
      // disable these other commands
      this.parseWaterfall.addFirst(
        'instantWaterfall',
        new DisabledMap({
          disabledMap: options.level.disabledMap,
        }).getInstantCommands(),
      );
    }
  },

  initGitShim(options) {
    // ok we definitely want a shim here
    this.gitShim = new GitShim({
      beforeCB: this.beforeCommandCB.bind(this),
      afterCB: this.afterCommandCB.bind(this),
      afterDeferHandler: this.afterCommandDefer.bind(this),
    });
  },

  undo() {
    this.gitCommandsIssued.pop();
    Reflect.apply(Level.__super__.undo, this, arguments);
  },

  beforeCommandCB(command) {
    // Alright we actually no-op this in the level subclass
    // so we can tell if the command counted or not... kinda :P
    // We have to save the state in this method since the git
    // engine will change by the time afterCommandCB runs
    this._treeBeforeCommand = this.mainVis.gitEngine.printTree();
  },

  afterCommandCB(command) {
    if (this.doesCommandCountTowardsTotal(command)) {
      // Count it as a command AND...
      this.gitCommandsIssued.push(command.get('rawStr'));
      // add our state for undo since our undo pops a command.
      //
      // Ugly inheritance overriding on private implementations ahead!
      this.undoStack.push(this._treeBeforeCommand);
    }
  },

  doesCommandCountTowardsTotal(command) {
    if (command.get('error')) {
      // don't count errors towards our count
      return false;
    }

    let matched = false;
    const commandsThatCount = Commands.commands.getCommandsThatCount();
    for (const map of Object.values(commandsThatCount)) {
      for (const regex of Object.values(map)) {
        matched = matched || regex.test(command.get('rawStr'));
      }
    }
    return matched;
  },

  afterCommandDefer(defer, command) {
    if (this.solved) {
      command.addWarning(intl.str('already-solved'));
      defer.resolve();
      return;
    }

    const current = this.mainVis.gitEngine.printTree();
    const solved = TreeCompare.dispatchFromLevel(this.level, current);

    if (!solved) {
      defer.resolve();
      return;
    }

    // woohoo!!! they solved the level, lets animate and such
    this.levelSolved(defer);
  },

  getNumSolutionCommands() {
    // strip semicolons in bad places
    const toAnalyze = this.level.solutionCommand.replace(/^;|;$/g, '');
    return toAnalyze.split(';').length;
  },

  testOption(option) {
    return this.options.command && new RegExp(`--${option}`).test(this.options.command.get('rawStr'));
  },

  testOptionOnString(string, option) {
    return string && new RegExp(`--${option}`).test(string);
  },

  levelSolved(defer) {
    this.solved = true;
    if (!this.isShowingSolution) {
      LevelActions.setLevelSolved(this.level.id);
      log.levelSolved(this.getEnglishName());
    }

    this.hideGoal();

    const nextLevel = LevelStore.getNextLevel(this.level.id);
    const numberCommands = this.gitCommandsIssued.length;
    const best = this.getNumSolutionCommands();

    const skipFinishDialog = this.testOption('noFinishDialog')
      || this.wasResetAfterSolved;
    const skipFinishAnimation = this.wasResetAfterSolved;

    if (!skipFinishAnimation) {
      GlobalStateActions.levelSolved();
    }

    /**
     * Speed up the animation each time we see it.
     */
    let speed = 1;
    switch (GlobalStateStore.getNumLevelsSolved()) {
      case 2:
        speed = 1.5;
        break;
      case 3:
        speed = 1.8;
        break;
      case 4:
        speed = 2.1;
        break;
      case 5:
        speed = 2.4;
        break;
    }
    if (GlobalStateStore.getNumLevelsSolved() > 5) {
      speed = 2.5;
    }

    let finishAnimationChain = null;
    if (skipFinishAnimation) {
      const deferred = Q.defer();
      deferred.resolve();
      finishAnimationChain = deferred.promise;
      Main.getEventBaton().trigger(
        'commandSubmitted',
        "echo \"level solved! type in 'levels' to access the next level\"",
      );
    } else {
      GlobalStateActions.changeIsAnimating(true);
      finishAnimationChain = this.mainVis.gitVisuals.finishAnimation(speed);
      if (this.mainVis.originVis) {
        finishAnimationChain = finishAnimationChain.then(
          this.mainVis.originVis.gitVisuals.finishAnimation(speed),
        );
      }
    }

    if (!skipFinishDialog) {
      finishAnimationChain = finishAnimationChain.then(() => {
        // we want to ask if they will move onto the next level
        // while giving them their results...
        const nextDialog = new NextLevelConfirm({
          nextLevel,
          numCommands: numberCommands,
          best,
        });

        return nextDialog.getPromise();
      });
    }

    finishAnimationChain
      .then(() => {
        if (!skipFinishDialog && nextLevel) {
          log.choseNextLevel(nextLevel.id);
          Main.getEventBaton().trigger(
            'commandSubmitted',
            `level ${nextLevel.id}`,
          );
        }
      })
      .fail(() => {
      // nothing to do, we will just close
      })
      .done(() => {
        GlobalStateActions.changeIsAnimating(false);
        defer.resolve();
      });
  },

  die() {
    ReactDOM.unmountComponentAtNode(
      document.querySelector('#levelToolbarMount'),
    );

    this.hideGoal();
    this.mainVis.die();
    this.releaseControl();

    this.clear();

    delete this.commandCollection;
    delete this.mainVis;
    delete this.goalVis;
    delete this.goalCanvasHolder;
  },

  getInstantCommands() {
    const getHint = function () {
      const hint = intl.getHint(this.level);
      if (!hint || hint.length === 0) {
        return intl.str('no-hint');
      }
      return hint;
    }.bind(this);

    return [
      [/^help$|^\?$/, function () {
        throw new Errors.CommandResult({
          msg: intl.str('help-vague-level'),
        });
      }],
      [/^hint$/, function () {
        throw new Errors.CommandResult({
          msg: getHint(),
        });
      }],
    ];
  },

  reset(command, deferred) {
    this.gitCommandsIssued = [];

    const commandString = (command) ? command.get('rawStr') : '';
    if (!this.testOptionOnString(commandString, 'forSolution')) {
      this.isShowingSolution = false;
    }
    if (this.solved) {
      this.wasResetAfterSolved = true;
    }
    this.solved = false;
    Reflect.apply(Level.__super__.reset, this, arguments);
  },

  buildLevel(command, deferred) {
    this.exitLevel();
    setTimeout(() => {
      Main.getSandbox().buildLevel(command, deferred);
    }, this.getAnimationTime() * 1.5);
  },

  importLevel(command, deferred) {
    this.exitLevel();
    setTimeout(() => {
      Main.getSandbox().importLevel(command, deferred);
    }, this.getAnimationTime() * 1.5);
  },

  startLevel(command, deferred) {
    this.exitLevel();

    setTimeout(() => {
      Main.getSandbox().startLevel(command, deferred);
    }, this.getAnimationTime() * 1.5);
    // wow! that was simple :D
  },

  exitLevel(command, deferred) {
    this.die();

    if (!command || !deferred) {
      return;
    }

    setTimeout(() => {
      command.finishWith(deferred);
    }, this.getAnimationTime());

    // we need to fade in the sandbox
    Main.getEventBaton().trigger('levelExited');
  },

  processLevelCommand(command, defer) {
    const methodMap = {
      'show goal': this.showGoal,
      'hide goal': this.hideGoal,
      'show solution': this.showSolution,
      'start dialog': this.startDialog,
      'help level': this.startDialog,
      objective: this.objectiveDialog,
    };
    const method = methodMap[command.get('method')];
    if (!method) {
      throw new Error("woah we don't support that method yet", method);
    }

    Reflect.apply(method, this, [command, defer]);
  },
});

exports.Level = Level;
exports.regexMap = regexMap;
