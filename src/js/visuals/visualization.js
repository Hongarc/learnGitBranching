const Backbone = require('backbone');

const Collections = require('../models/collections');

const { CommitCollection } = Collections;
const { BranchCollection } = Collections;
const { TagCollection } = Collections;
const { EventBaton } = require('../util/eventBaton');

const { GitVisuals } = require('.');

const Visualization = Backbone.View.extend({
  initialize(options = {}) {
    this.options = options;
    this.customEvents = { ...Backbone.Events };
    this.containerElement = options.containerElement;

    const _this = this;
    // we want to add our canvas somewhere
    const container = options.containerElement || $('#canvasHolder')[0];
    new Raphael(container, 200, 200, function () {
      // raphael calls with paper as this for some inane reason...
      const paper = this;
      // use process.nextTick to go from sync to async
      process.nextTick(() => {
        _this.paperInitialize(paper, options);
      });
    });
  },

  paperInitialize(paper, options) {
    this.treeString = options.treeString;
    this.paper = paper;

    const Main = require('../app');
    // if we don't want to receive keyboard input (directly),
    // make a new event baton so git engine steals something that no one
    // is broadcasting to
    this.eventBaton = (options.noKeyboardInput)
      ? new EventBaton({ noInput: true })
      : Main.getEventBaton();

    this.commitCollection = new CommitCollection();
    this.branchCollection = new BranchCollection();
    this.tagCollection = new TagCollection();

    this.gitVisuals = new GitVisuals({
      commitCollection: this.commitCollection,
      branchCollection: this.branchCollection,
      tagCollection: this.tagCollection,
      paper: this.paper,
      noClick: this.options.noClick,
      isGoalVis: this.options.isGoalVis,
      smallCanvas: this.options.smallCanvas,
      visualization: this,
    });

    const { GitEngine } = require('../git');
    this.gitEngine = new GitEngine({
      collection: this.commitCollection,
      branches: this.branchCollection,
      tags: this.tagCollection,
      gitVisuals: this.gitVisuals,
      eventBaton: this.eventBaton,
    });
    this.gitEngine.init();
    this.gitVisuals.assignGitEngine(this.gitEngine);

    this.myResize();

    $(window).on('resize', () => this.myResize());

    // If the visualization is within a draggable container, we need to update the
    // position whenever the container is moved.
    this.$el.parents('.ui-draggable').on('drag', (event, ui) => {
      this.customEvents.trigger('drag', event, ui);
      this.myResize();
    });

    this.gitVisuals.drawTreeFirstTime();
    if (this.treeString) {
      this.gitEngine.loadTreeFromString(this.treeString);
    }
    if (this.options.zIndex) {
      this.setTreeIndex(this.options.zIndex);
    }

    this.shown = false;
    this.setTreeOpacity(0);
    // reflow needed
    process.nextTick(this.fadeTreeIn.bind(this));

    this.customEvents.trigger('gitEngineReady');
    this.customEvents.trigger('paperReady');
  },

  clearOrigin() {
    delete this.originVis;
  },

  makeOrigin(options) {
    // oh god, here we go. We basically do a bizarre form of composition here,
    // where this visualization actually contains another one of itself.
    this.originVis = new Visualization({

      // copy all of our options over, except...
      ...this.options,
      // never accept keyboard input or clicks
      noKeyboardInput: true,
      noClick: true,
      treeString: options.treeString,
    });
    // if the z index is set on ours, carry that over
    this.originVis.customEvents.on('paperReady', () => {
      const value = $(this.paper.canvas).css('z-index');
      this.originVis.setTreeIndex(value);
    });

    // return the newly created visualization which will soon have a git engine
    return this.originVis;
  },

  originToo(methodToCall, arguments_) {
    if (!this.originVis) {
      return;
    }
    const callMethod = function () {
      this.originVis[methodToCall].apply(this.originVis, arguments_);
    }.bind(this);

    if (this.originVis.paper) {
      callMethod();
      return;
    }
    // this is tricky -- sometimes we already have paper initialized but
    // our origin vis does not (since we kill that on every reset).
    // in this case lets bind to the custom event on paper ready
    this.originVis.customEvents.on('paperReady', callMethod);
  },

  setTreeIndex(level) {
    $(this.paper.canvas).css('z-index', level);
    this.originToo('setTreeIndex', arguments);
  },

  setTreeOpacity(level) {
    if (level === 0) {
      this.shown = false;
    }

    $(this.paper.canvas).css('opacity', level);
    this.originToo('setTreeOpacity', arguments);
  },

  getAnimationTime() { return 300; },

  fadeTreeIn() {
    this.shown = true;
    if (!this.paper) {
      return;
    }
    $(this.paper.canvas).animate({ opacity: 1 }, this.getAnimationTime());

    this.originToo('fadeTreeIn', arguments);
  },

  fadeTreeOut() {
    this.shown = false;
    if (this.paper && this.paper.canvas) {
      $(this.paper.canvas).animate({ opacity: 0 }, this.getAnimationTime());
    }
    this.originToo('fadeTreeOut', arguments);
  },

  hide() {
    this.fadeTreeOut();
    // remove click handlers by toggling visibility
    setTimeout(() => {
      $(this.paper.canvas).css('visibility', 'hidden');
    }, this.getAnimationTime());
    this.originToo('hide', arguments);
  },

  show() {
    $(this.paper.canvas).css('visibility', 'visible');
    setTimeout(this.fadeTreeIn.bind(this), 10);
    this.originToo('show', arguments);
    this.myResize();
  },

  showHarsh() {
    $(this.paper.canvas).css('visibility', 'visible');
    this.setTreeOpacity(1);
    this.originToo('showHarsh', arguments);
    this.myResize();
  },

  resetFromThisTreeNow(treeString) {
    this.treeString = treeString;
    // do the same but for origin tree string
    const oTree = this.getOriginInTreeString(treeString);
    if (oTree) {
      const oTreeString = this.gitEngine.printTree(oTree);
      this.originToo('resetFromThisTreeNow', [oTreeString]);
    }
  },

  getOriginInTreeString(treeString) {
    const tree = JSON.parse(unescape(treeString));
    return tree.originTree;
  },

  reset(tree) {
    const treeString = tree || this.treeString;
    this.setTreeOpacity(0);
    if (treeString) {
      this.gitEngine.loadTreeFromString(treeString);
    } else {
      this.gitEngine.defaultInit();
    }
    this.fadeTreeIn();

    if (this.originVis) {
      if (treeString) {
        const oTree = this.getOriginInTreeString(treeString);
        this.originToo('reset', [JSON.stringify(oTree)]);
      } else {
        // easy
        this.originToo('reset', arguments);
      }
    }
  },

  tearDown(options) {
    options = options || {};

    this.gitEngine.tearDown();
    this.gitVisuals.tearDown();
    delete this.paper;
    this.originToo('tearDown', arguments);
  },

  die() {
    this.fadeTreeOut();
    setTimeout(() => {
      if (!this.shown) {
        this.tearDown({ fromDie: true });
      }
    }, this.getAnimationTime());
    this.originToo('die', arguments);
  },

  myResize() {
    if (!this.paper) { return; }

    const { el } = this;

    const elementSize = el.getBoundingClientRect();
    const { width } = elementSize;
    const { height } = elementSize;

    // if we don't have a container, we need to set our
    // position absolutely to whatever we are tracking
    if (!this.containerElement) {
      const { left } = this.$el.offset();
      const { top } = this.$el.offset();

      $(this.paper.canvas).css({
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
      });
    } else {
      // set position to absolute so we all stack nicely
      $(this.paper.canvas).css({
        position: 'absolute',
      });
    }

    this.paper.setSize(width, height);
    this.gitVisuals.canvasResize(width, height);
    this.originToo('myResize', arguments);
  },
});

exports.Visualization = Visualization;
