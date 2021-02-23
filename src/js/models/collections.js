const Q = require('q');
const Backbone = require('backbone');

const { Commit } = require('../git');
const { Branch } = require('../git');
const { Tag } = require('../git');

const { Command } = require('./commandModel');
const { TIME } = require('../util/constants');

const intl = require('../intl');

const CommitCollection = Backbone.Collection.extend({
  model: Commit,
});

const CommandCollection = Backbone.Collection.extend({
  model: Command,
});

const BranchCollection = Backbone.Collection.extend({
  model: Branch,
});

const TagCollection = Backbone.Collection.extend({
  model: Tag,
});

const CommandBuffer = Backbone.Model.extend({
  defaults: {
    collection: null,
  },

  initialize(options) {
    options.collection.bind('add', this.addCommand, this);

    this.buffer = [];
    this.timeout = null;
  },

  addCommand(command) {
    this.buffer.push(command);
    this.touchBuffer();
  },

  touchBuffer() {
    // touch buffer just essentially means we just check if our buffer is being
    // processed. if it's not, we immediately process the first item
    // and then set the timeout.
    if (this.timeout) {
      // timeout existence implies its being processed
      return;
    }
    this.setTimeout();
  },

  setTimeout() {
    this.timeout = setTimeout(() => {
      this.sipFromBuffer();
    }, TIME.betweenCommandsDelay);
  },

  popAndProcess() {
    let popped = this.buffer.shift(0);

    // find a command with no error (aka unprocessed)
    while (popped.get('error') && this.buffer.length > 0) {
      popped = this.buffer.shift(0);
    }
    if (!popped.get('error')) {
      this.processCommand(popped);
    } else {
      // no more commands to process
      this.clear();
    }
  },

  processCommand(command) {
    command.set('status', 'processing');

    const deferred = Q.defer();
    deferred.promise.then(() => {
      this.setTimeout();
    });

    const eventName = command.get('eventName');
    if (!eventName) {
      throw new Error('I need an event to trigger when this guy is parsed and ready');
    }

    const Main = require('../app');
    const eventBaton = Main.getEventBaton();

    const numberListeners = eventBaton.getNumListeners(eventName);
    if (!numberListeners) {
      const Errors = require('../util/errors');
      command.set('error', new Errors.GitError({
        msg: intl.str('error-command-currently-not-supported'),
      }));
      deferred.resolve();
      return;
    }

    Main.getEventBaton().trigger(eventName, command, deferred);
  },

  clear() {
    clearTimeout(this.timeout);
    this.timeout = null;
  },

  sipFromBuffer() {
    if (this.buffer.length === 0) {
      this.clear();
      return;
    }

    this.popAndProcess();
  },
});

exports.CommitCollection = CommitCollection;
exports.CommandCollection = CommandCollection;
exports.BranchCollection = BranchCollection;
exports.TagCollection = TagCollection;
exports.CommandBuffer = CommandBuffer;
