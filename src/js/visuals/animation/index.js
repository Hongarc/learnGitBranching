const Q = require('q');
const Backbone = require('backbone');
const GlobalStateActions = require('../../actions/GlobalStateActions');
const { GRAPHICS } = require('../../util/constants');

const Animation = Backbone.Model.extend({
  defaults: {
    duration: GRAPHICS.defaultAnimationTime,
    closure: null,
  },

  validateAtInit() {
    if (!this.get('closure')) {
      throw new Error('give me a closure!');
    }
  },

  initialize(options) {
    this.validateAtInit();
  },

  run() {
    this.get('closure')();
  },
});

const AnimationQueue = Backbone.Model.extend({
  defaults: {
    animations: null,
    index: 0,
    callback: null,
    defer: false,
    promiseBased: false,
  },

  initialize(options) {
    this.set('animations', []);
    if (!options.callback) {
      console.warn('no callback');
    }
  },

  thenFinish(promise, deferred) {
    promise.then(() => {
      this.finish();
    });
    promise.fail((e) => {
      console.log('uncaught error', e);
      throw e;
    });
    this.set('promiseBased', true);
    if (deferred) {
      deferred.resolve();
    }
  },

  add(animation) {
    if (!(animation instanceof Animation)) {
      throw new TypeError('Need animation not something else');
    }

    this.get('animations').push(animation);
  },

  start() {
    this.set('index', 0);

    // set the global lock that we are animating
    GlobalStateActions.changeIsAnimating(true);
    this.next();
  },

  finish() {
    // release lock here
    GlobalStateActions.changeIsAnimating(false);
    this.get('callback')();
  },

  next() {
    // ok so call the first animation, and then set a timeout to call the next.
    // since an animation is defined as taking a specific amount of time,
    // we can simply just use timeouts rather than promises / deferreds.

    // for graphical displays that require an unknown amount of time, use deferreds
    // but not animation queue (see the finishAnimation for that)
    const animations = this.get('animations');
    const index = this.get('index');
    if (index >= animations.length) {
      this.finish();
      return;
    }

    const next = animations[index];
    const duration = next.get('duration');

    next.run();

    this.set('index', index + 1);
    setTimeout(() => {
      this.next();
    }, duration);
  },
});

const PromiseAnimation = Backbone.Model.extend({
  defaults: {
    deferred: null,
    closure: null,
    duration: GRAPHICS.defaultAnimationTime,
  },

  initialize(options) {
    if (!options.closure && !options.animation) {
      throw new Error('need closure or animation');
    }
    this.set('closure', options.closure || options.animation);
    this.set('duration', options.duration || this.get('duration'));
    this.set('deferred', options.deferred || Q.defer());
  },

  getPromise() {
    return this.get('deferred').promise;
  },

  play() {
    // a single animation is just something with a timeout, but now
    // we want to resolve a deferred when the animation finishes
    this.get('closure')();
    setTimeout(() => {
      this.get('deferred').resolve();
    }, this.get('duration'));
  },

  then(function_) {
    return this.get('deferred').promise.then(function_);
  },
});

PromiseAnimation.fromAnimation = function (animation) {
  return new PromiseAnimation({
    closure: animation.get('closure'),
    duration: animation.get('duration'),
  });
};

exports.Animation = Animation;
exports.PromiseAnimation = PromiseAnimation;
exports.AnimationQueue = AnimationQueue;
