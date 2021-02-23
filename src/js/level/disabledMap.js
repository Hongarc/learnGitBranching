const intl = require('../intl');

const Commands = require('../commands');

const Errors = require('../util/errors');

const { GitError } = Errors;

function DisabledMap(options = {}) {
  this.disabledMap = options.disabledMap || {
    'git cherry-pick': true,
    'git rebase': true,
  };
}

const onMatch = () => {
  throw new GitError({
    msg: intl.str('command-disabled'),
  });
};

DisabledMap.prototype.getInstantCommands = function () {
  // this produces an array of regex / function pairs that can be
  // piped into a parse waterfall to disable certain git commands
  // :D
  const instants = [];

  Object.keys(this.disabledMap).forEach((disabledCommand) => {
    // XXX get hold of vcs from disabledMap
    const vcs = 'git';
    const disabledCommand2 = disabledCommand.slice(vcs.length + 1);
    const gitRegex = Commands.commands.getRegexMap()[vcs][disabledCommand2];
    if (!gitRegex) {
      throw new Error(`wuttttt this disabled command ${disabledCommand2} has no regex matching`);
    }
    instants.push([gitRegex, onMatch]);
  });
  return instants;
};

exports.DisabledMap = DisabledMap;
