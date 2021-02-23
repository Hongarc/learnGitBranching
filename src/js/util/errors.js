const Backbone = require('backbone');

const MyError = Backbone.Model.extend({
  defaults: {
    type: 'MyError',
  },
  toString() {
    return `${this.get('type')}: ${this.get('msg')}`;
  },

  getMsg() {
    if (!this.get('msg')) {
      debugger;
      console.warn('my error without message');
    }
    return this.get('msg');
  },
});

const CommandProcessError = exports.CommandProcessError = MyError.extend({
  defaults: {
    type: 'Command Process Error',
  },
});

const CommandResult = exports.CommandResult = MyError.extend({
  defaults: {
    type: 'Command Result',
  },
});

const Warning = exports.Warning = MyError.extend({
  defaults: {
    type: 'Warning',
  },
});

const GitError = exports.GitError = MyError.extend({
  defaults: {
    type: 'Git Error',
  },
});

const filterError = function (error) {
  if (error instanceof CommandProcessError
      || error instanceof GitError
      || error instanceof CommandResult
      || error instanceof Warning) {
    // yay! one of ours

  } else {
    throw error;
  }
};

exports.filterError = filterError;
