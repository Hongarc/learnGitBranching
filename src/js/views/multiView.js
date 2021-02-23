const Q = require('q');
const Backbone = require('backbone');

const { LeftRightView } = require('.');
const { ModalAlert } = require('.');
const { GitDemonstrationView } = require('./gitDemonstrationView');

const BuilderViews = require('./builderViews');

const { MarkdownPresenter } = BuilderViews;

const { KeyboardListener } = require('../util/keyboard');
const debounce = require('../util/debounce');

const MultiView = Backbone.View.extend({
  tagName: 'div',
  className: 'multiView',
  // ms to debounce the nav functions
  navEventDebounce: 550,
  deathTime: 700,

  // a simple mapping of what childViews we support
  typeToConstructor: {
    ModalAlert,
    GitDemonstrationView,
    MarkdownPresenter,
  },

  initialize(options = {}) {
    this.childViewJSONs = options.childViews || [{
      type: 'ModalAlert',
      options: {
        markdown: 'Woah wtf!!',
      },
    }, {
      type: 'GitDemonstrationView',
      options: {
        command: 'git checkout -b side; git commit; git commit',
      },
    }, {
      type: 'ModalAlert',
      options: {
        markdown: 'Im second',
      },
    }];
    this.deferred = options.deferred || Q.defer();

    this.childViews = [];
    this.currentIndex = 0;

    this.navEvents = { ...Backbone.Events };
    this.navEvents.on('negative', this.getNegFunc(), this);
    this.navEvents.on('positive', this.getPosFunc(), this);
    this.navEvents.on('quit', this.finish, this);
    this.navEvents.on('exit', this.finish, this);

    this.keyboardListener = new KeyboardListener({
      events: this.navEvents,
      aliasMap: {
        left: 'negative',
        right: 'positive',
        enter: 'positive',
        esc: 'quit',
      },
    });

    this.render();
    if (!options.wait) {
      this.start();
    }
  },

  onWindowFocus() {
    // nothing here for now...
    // TODO -- add a cool glow effect?
  },

  getAnimationTime() {
    return 700;
  },

  getPromise() {
    return this.deferred.promise;
  },

  getPosFunc() {
    return debounce(() => {
      this.navForward();
    }, this.navEventDebounce, true);
  },

  getNegFunc() {
    return debounce(() => {
      this.navBackward();
    }, this.navEventDebounce, true);
  },

  lock() {
    this.locked = true;
  },

  unlock() {
    this.locked = false;
  },

  navForward() {
    // we need to prevent nav changes when a git demonstration view hasnt finished
    if (this.locked) { return; }
    if (this.currentIndex === this.childViews.length - 1) {
      this.hideViewIndex(this.currentIndex);
      this.finish();
      return;
    }

    this.navIndexChange(1);
  },

  navBackward() {
    if (this.currentIndex === 0) {
      return;
    }

    this.navIndexChange(-1);
  },

  navIndexChange(delta) {
    this.hideViewIndex(this.currentIndex);
    this.currentIndex += delta;
    this.showViewIndex(this.currentIndex);
  },

  hideViewIndex(index) {
    this.childViews[index].hide();
  },

  showViewIndex(index) {
    this.childViews[index].show();
  },

  finish() {
    // first we stop listening to keyboard and give that back to UI, which
    // other views will take if they need to
    this.keyboardListener.mute();

    this.childViews.forEach((childView) => {
      childView.die();
    });

    this.deferred.resolve();
  },

  start() {
    // steal the window focus baton
    this.showViewIndex(this.currentIndex);
  },

  createChildView(viewJSON) {
    const { type } = viewJSON;
    if (!this.typeToConstructor[type]) {
      throw new Error(`no constructor for type "${type}"`);
    }
    const view = new this.typeToConstructor[type]({
      wait: true,
      ...viewJSON.options,
    });
    return view;
  },

  addNavToView(view, index) {
    const leftRight = new LeftRightView({
      events: this.navEvents,
      // we want the arrows to be on the same level as the content (not
      // beneath), so we go one level up with getDestination()
      destination: view.getDestination(),
      showLeft: (index !== 0),
      lastNav: (index === this.childViewJSONs.length - 1),
    });
    if (view.receiveMetaNav) {
      view.receiveMetaNav(leftRight, this);
    }
  },

  render() {
    // go through each and render... show the first
    this.childViewJSONs.forEach(function (childViewJSON, index) {
      const childView = this.createChildView(childViewJSON);
      this.childViews.push(childView);
      this.addNavToView(childView, index);
    }, this);
  },
});

exports.MultiView = MultiView;
