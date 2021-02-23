const Backbone = require('backbone');
const Q = require('q');

const { GitEngine } = require('.');
const { AnimationFactory } = require('../visuals/animation/animationFactory');
const { GitVisuals } = require('../visuals');
const TreeCompare = require('../graph/treeCompare');
const { EventBaton } = require('../util/eventBaton');

const Collections = require('../models/collections');

const { CommitCollection } = Collections;
const { BranchCollection } = Collections;
const { TagCollection } = Collections;
const { Command } = require('../models/commandModel');

const { mock } = require('../util/mock');
const util = require('../util');

function getMockFactory() {
  const mockFactory = {};
  const mockReturn = function () {
    const d = Q.defer();
    // fall through!
    d.resolve();
    return d.promise;
  };
  for (const key in AnimationFactory) {
    mockFactory[key] = mockReturn;
  }

  mockFactory.playRefreshAnimationAndFinish = function (gitVisuals, aQueue) {
    aQueue.finish();
  };
  mockFactory.refreshTree = function (aQueue, gitVisuals) {
    aQueue.finish();
  };

  mockFactory.highlightEachWithPromise = function (chain, toRebase, destinationBranch) {
    // don't add any steps
    return chain;
  };

  return mockFactory;
}

function getMockVisualization() {
  return {
    makeOrigin(options) {
      const { localRepo } = options;
      const { treeString } = options;

      const headless = new HeadlessGit();
      headless.gitEngine.loadTreeFromString(treeString);
      return {
        customEvents: {
          on(key, callback, context) {
            callback.apply(context, []);
          },
        },
        gitEngine: headless.gitEngine,
      };
    },
  };
}

var HeadlessGit = function () {
  this.init();
};

HeadlessGit.prototype.init = function () {
  this.commitCollection = new CommitCollection();
  this.branchCollection = new BranchCollection();
  this.tagCollection = new TagCollection();

  // here we mock visuals and animation factory so the git engine
  // is headless
  const animationFactory = getMockFactory();
  const gitVisuals = mock(GitVisuals);
  // add some stuff for origin making
  const mockVis = getMockVisualization();
  gitVisuals.getVisualization = function () {
    return mockVis;
  };

  this.gitEngine = new GitEngine({
    collection: this.commitCollection,
    branches: this.branchCollection,
    tags: this.tagCollection,
    gitVisuals,
    animationFactory,
    eventBaton: new EventBaton(),
  });
  this.gitEngine.init();
};

// horrible hack so we can just quickly get a tree string for async git
// operations, aka for git demonstration views
const getTreeQuick = function (commandString, getTreePromise) {
  const deferred = Q.defer();
  const headless = new HeadlessGit();
  headless.sendCommand(commandString, deferred);
  deferred.promise.then(() => {
    getTreePromise.resolve(headless.gitEngine.exportTree());
  });
};

HeadlessGit.prototype.sendCommand = function (value, entireCommandPromise) {
  const deferred = Q.defer();
  let chain = deferred.promise;
  const startTime = Date.now();

  const commands = [];

  util.splitTextCommand(value, function (commandString) {
    chain = chain.then(() => {
      const commandObject = new Command({
        rawStr: commandString,
      });

      const thisDeferred = Q.defer();
      this.gitEngine.dispatch(commandObject, thisDeferred);
      commands.push(commandObject);
      return thisDeferred.promise;
    });
  }, this);

  chain.then(() => {
    const nowTime = Date.now();
    if (entireCommandPromise) {
      entireCommandPromise.resolve(commands);
    }
  });

  chain.fail((error) => {
    console.log('!!!!!!!! error !!!!!!!');
    console.log(error);
    console.log(error.stack);
    console.log('!!!!!!!!!!!!!!!!!!!!!!');
  });
  deferred.resolve();
  return chain;
};

exports.HeadlessGit = HeadlessGit;
exports.getTreeQuick = getTreeQuick;
