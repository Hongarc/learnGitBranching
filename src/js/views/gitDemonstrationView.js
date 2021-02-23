const _ = require('underscore');
const Q = require('q');
const Backbone = require('backbone');
const marked = require('marked');

const util = require('../util');
const intl = require('../intl');
const { KeyboardListener } = require('../util/keyboard');
const { Command } = require('../models/commandModel');

const { ModalTerminal } = require('.');
const { ContainedBase } = require('.');

const { Visualization } = require('../visuals/visualization');
const HeadlessGit = require('../git/headless');

var GitDemonstrationView = ContainedBase.extend({
  tagName: 'div',
  className: 'gitDemonstrationView box horizontal',
  template: _.template($('#git-demonstration-view').html()),

  events: {
    'click div.command > p.uiButton': 'positive',
  },

  initialize(options) {
    options = options || {};
    this.options = options;
    this.JSON = {
      beforeMarkdowns: [
        '## Git Commits',
        '',
        'Awesome!',
      ],
      command: 'git commit',
      afterMarkdowns: [
        'Now you have seen it in action',
        '',
        'Go ahead and try the level!',
      ],
      ...options,
    };

    const convert = function (markdowns) {
      return marked(markdowns.join('\n'));
    };

    this.JSON.beforeHTML = convert(this.JSON.beforeMarkdowns);
    this.JSON.afterHTML = convert(this.JSON.afterMarkdowns);

    this.container = new ModalTerminal({
      title: options.title || intl.str('git-demonstration-title'),
    });
    this.render();
    this.checkScroll();

    this.navEvents = { ...Backbone.Events };
    this.navEvents.on('positive', this.positive, this);
    this.navEvents.on('negative', this.negative, this);
    this.keyboardListener = new KeyboardListener({
      events: this.navEvents,
      aliasMap: {
        enter: 'positive',
        right: 'positive',
        left: 'negative',
      },
      wait: true,
    });

    this.visFinished = false;
    this.initVis();

    if (!options.wait) {
      this.show();
    }
  },

  receiveMetaNav(navView, metaContainerView) {
    const _this = this;
    navView.navEvents.on('positive', this.positive, this);
    this.metaContainerView = metaContainerView;
  },

  checkScroll() {
    const children = this.$('div.demonstrationText').children().toArray();
    const heights = children.map((child) => child.clientHeight);
    const totalHeight = heights.reduce((a, b) => a + b);
    if (totalHeight < this.$('div.demonstrationText').height()) {
      this.$('div.demonstrationText').addClass('noLongText');
    }
  },

  dispatchBeforeCommand() {
    if (!this.options.beforeCommand) {
      return;
    }

    const whenHaveTree = Q.defer();
    HeadlessGit.getTreeQuick(this.options.beforeCommand, whenHaveTree);
    whenHaveTree.promise.then((tree) => {
      this.mainVis.gitEngine.loadTree(tree);
      this.mainVis.gitVisuals.refreshTreeHarsh();
    });
  },

  takeControl() {
    this.hasControl = true;
    this.keyboardListener.listen();

    if (this.metaContainerView) { this.metaContainerView.lock(); }
  },

  releaseControl() {
    if (!this.hasControl) { return; }
    this.hasControl = false;
    this.keyboardListener.mute();

    if (this.metaContainerView) { this.metaContainerView.unlock(); }
  },

  reset() {
    this.mainVis.reset();
    this.dispatchBeforeCommand();
    this.demonstrated = false;
    this.$el.toggleClass('demonstrated', false);
    this.$el.toggleClass('demonstrating', false);
  },

  positive() {
    if (this.demonstrated || !this.hasControl) {
      // don't do anything if we are demonstrating, and if
      // we receive a meta nav event and we aren't listening,
      // then don't do anything either
      return;
    }
    this.demonstrated = true;
    this.demonstrate();
  },

  demonstrate() {
    this.$el.toggleClass('demonstrating', true);

    const whenDone = Q.defer();
    this.dispatchCommand(this.JSON.command, whenDone);
    whenDone.promise.then(() => {
      this.$el.toggleClass('demonstrating', false);
      this.$el.toggleClass('demonstrated', true);
      this.releaseControl();
    });
  },

  negative(e) {
    if (this.$el.hasClass('demonstrating')) {
      return;
    }
    this.keyboardListener.passEventBack(e);
  },

  dispatchCommand(value, whenDone) {
    const commands = [];
    util.splitTextCommand(value, (commandString) => {
      commands.push(new Command({
        rawStr: commandString,
      }));
    }, this);

    const chainDeferred = Q.defer();
    let chainPromise = chainDeferred.promise;

    commands.forEach(function (command, index) {
      chainPromise = chainPromise.then(() => {
        const myDefer = Q.defer();
        this.mainVis.gitEngine.dispatch(command, myDefer);
        return myDefer.promise;
      });
      chainPromise = chainPromise.then(() => Q.delay(300));
    }, this);

    chainPromise = chainPromise.then(() => {
      whenDone.resolve();
    });

    chainDeferred.resolve();
  },

  tearDown() {
    this.mainVis.tearDown();
    GitDemonstrationView.__super__.tearDown.apply(this);
  },

  hide() {
    this.releaseControl();
    this.reset();
    if (this.visFinished) {
      this.mainVis.setTreeIndex(-1);
      this.mainVis.setTreeOpacity(0);
    }

    this.shown = false;
    GitDemonstrationView.__super__.hide.apply(this);
  },

  show() {
    this.takeControl();
    if (this.visFinished) {
      setTimeout(() => {
        if (this.shown) {
          this.mainVis.setTreeIndex(300);
          this.mainVis.showHarsh();
        }
      }, this.getAnimationTime() * 1.5);
    }

    this.shown = true;
    GitDemonstrationView.__super__.show.apply(this);
  },

  die() {
    if (!this.visFinished) { return; }

    GitDemonstrationView.__super__.die.apply(this);
  },

  initVis() {
    this.mainVis = new Visualization({
      el: this.$('div.visHolder div.visHolderInside')[0],
      noKeyboardInput: true,
      noClick: true,
      smallCanvas: true,
      zIndex: -1,
    });
    this.mainVis.customEvents.on('paperReady', () => {
      this.visFinished = true;
      this.dispatchBeforeCommand();
      if (this.shown) {
        // show the canvas once its done if we are shown
        this.show();
      }
    });
  },
});

exports.GitDemonstrationView = GitDemonstrationView;
