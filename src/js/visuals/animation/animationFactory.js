const Backbone = require('backbone');
const Q = require('q');

const { Animation } = require('./index');
const { PromiseAnimation } = require('./index');
const { GRAPHICS } = require('../../util/constants');

/** ****************
 * This class is responsible for a lot of the heavy lifting around creating an animation at a certain state in time.
 * The tricky thing is that when a new commit has to be "born," say in the middle of a rebase
 * or something, it must animate out from the parent position to it's birth position.

 * These two positions though may not be where the commit finally ends up. So we actually need to take a snapshot of the tree,
 * store all those positions, take a snapshot of the tree after a layout refresh afterwards, and then animate between those two spots.
 * and then essentially animate the entire tree too.
 */

// static class
const AnimationFactory = {};

const makeCommitBirthAnimation = function (gitVisuals, visNode) {
  const time = GRAPHICS.defaultAnimationTime * 1;
  const bounceTime = time * 2;

  const animation = function () {
    // essentially refresh the entire tree, but do a special thing for the commit
    gitVisuals.refreshTree(time);

    visNode.setBirth();
    visNode.parentInFront();
    gitVisuals.visBranchesFront();

    visNode.animateUpdatedPosition(bounceTime, 'bounce');
    visNode.animateOutgoingEdges(time);
  };
  return {
    animation,
    duration: Math.max(time, bounceTime),
  };
};

const makeHighlightAnimation = function (visNode, visBranch) {
  const fullTime = GRAPHICS.defaultAnimationTime * 0.66;
  const slowTime = fullTime * 2;

  return {
    animation() {
      visNode.highlightTo(visBranch, slowTime, 'easeInOut');
    },
    duration: slowTime * 1.5,
  };
};

AnimationFactory.genCommitBirthAnimation = function (animationQueue, commit, gitVisuals) {
  if (!animationQueue) {
    throw new Error('Need animation queue to add closure to!');
  }

  const visNode = commit.get('visNode');
  const anPack = makeCommitBirthAnimation(gitVisuals, visNode);

  animationQueue.add(new Animation({
    closure: anPack.animation,
    duration: anPack.duration,
  }));
};

AnimationFactory.genCommitBirthPromiseAnimation = function (commit, gitVisuals) {
  const visNode = commit.get('visNode');
  return new PromiseAnimation(makeCommitBirthAnimation(gitVisuals, visNode));
};

AnimationFactory.highlightEachWithPromise = function (
  chain,
  toHighlight,
  destinationObject,
) {
  for (const commit of toHighlight) {
    chain = chain.then(() => this.playHighlightPromiseAnimation(
      commit,
      destinationObject,
    ));
  }
  return chain;
};

AnimationFactory.playCommitBirthPromiseAnimation = function (commit, gitVisuals) {
  const animation = this.genCommitBirthPromiseAnimation(commit, gitVisuals);
  animation.play();
  return animation.getPromise();
};

AnimationFactory.playRefreshAnimationAndFinish = function (gitVisuals, animationQueue) {
  const animation = new PromiseAnimation({
    closure() {
      gitVisuals.refreshTree();
    },
  });
  animation.play();
  animationQueue.thenFinish(animation.getPromise());
};

AnimationFactory.genRefreshPromiseAnimation = function (gitVisuals) {
  return new PromiseAnimation({
    closure() {
      gitVisuals.refreshTree();
    },
  });
};

AnimationFactory.playRefreshAnimationSlow = function (gitVisuals) {
  const time = GRAPHICS.defaultAnimationTime;
  return this.playRefreshAnimation(gitVisuals, time * 2);
};

AnimationFactory.playRefreshAnimation = function (gitVisuals, speed) {
  const animation = new PromiseAnimation({
    duration: speed,
    closure() {
      gitVisuals.refreshTree(speed);
    },
  });
  animation.play();
  return animation.getPromise();
};

AnimationFactory.refreshTree = function (animationQueue, gitVisuals) {
  animationQueue.add(new Animation({
    closure() {
      gitVisuals.refreshTree();
    },
  }));
};

AnimationFactory.genHighlightPromiseAnimation = function (commit, destinationObject) {
  // could be branch or node
  const visObject = destinationObject.get('visBranch') || destinationObject.get('visNode')
    || destinationObject.get('visTag');
  if (!visObject) {
    console.log(destinationObject);
    throw new Error('could not find vis object for dest obj');
  }
  const visNode = commit.get('visNode');
  return new PromiseAnimation(makeHighlightAnimation(visNode, visObject));
};

AnimationFactory.playHighlightPromiseAnimation = function (commit, destinationObject) {
  const animation = this.genHighlightPromiseAnimation(commit, destinationObject);
  animation.play();
  return animation.getPromise();
};

AnimationFactory.getDelayedPromise = function (amount) {
  const deferred = Q.defer();
  setTimeout(deferred.resolve, amount || 1000);
  return deferred.promise;
};

AnimationFactory.delay = function (animationQueue, time) {
  time = time || GRAPHICS.defaultAnimationTime;
  animationQueue.add(new Animation({
    closure() {},
    duration: time,
  }));
};

exports.AnimationFactory = AnimationFactory;
