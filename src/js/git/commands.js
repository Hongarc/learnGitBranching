const escapeString = require('../util/escapeString');
const intl = require('../intl');

const Graph = require('../graph');
const Errors = require('../util/errors');

const { CommandProcessError } = Errors;
const { GitError } = Errors;
const { Warning } = Errors;
const { CommandResult } = Errors;

const ORIGIN_PREFIX = 'o/';

const crappyUnescape = function (string) {
  return string.replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
};

function isColonRefspec(string) {
  return string.includes(':') && string.split(':').length === 2;
}

const assertIsReference = function (engine, reference) {
  engine.resolveID(reference); // will throw git error if can't resolve
};

const validateBranchName = function (engine, name) {
  return engine.validateBranchName(name);
};

const validateOriginBranchName = function (engine, name) {
  return engine.origin.validateBranchName(name);
};

const validateBranchNameIfNeeded = function (engine, name) {
  if (engine.refs[name]) {
    return name;
  }
  return validateBranchName(engine, name);
};

const assertNotCheckedOut = function (engine, reference) {
  if (!engine.refs[reference]) {
    return;
  }
  if (engine.HEAD.get('target') === engine.refs[reference]) {
    throw new GitError({
      msg: intl.todo(
        `cannot fetch to ${reference} when checked out on ${reference}`,
      ),
    });
  }
};

const assertIsBranch = function (engine, reference) {
  assertIsReference(engine, reference);
  const object = engine.resolveID(reference);
  if (!object || object.get('type') !== 'branch') {
    throw new GitError({
      msg: intl.todo(
        `${reference} is not a branch`,
      ),
    });
  }
};

const assertIsRemoteBranch = function (engine, reference) {
  assertIsReference(engine, reference);
  const object = engine.resolveID(reference);

  if (object.get('type') !== 'branch'
      || !object.getIsRemote()) {
    throw new GitError({
      msg: intl.todo(
        `${reference} is not a remote branch`,
      ),
    });
  }
};

const assertOriginSpecified = function (generalArguments) {
  if (generalArguments.length === 0) {
    return;
  }
  if (generalArguments[0] !== 'origin') {
    throw new GitError({
      msg: intl.todo(
        `${generalArguments[0]} is not a remote in your repository! try adding origin to that argument`,
      ),
    });
  }
};

const assertBranchIsRemoteTracking = function (engine, branchName) {
  branchName = crappyUnescape(branchName);
  if (!engine.resolveID(branchName)) {
    throw new GitError({
      msg: intl.todo(`${branchName} is not a branch!`),
    });
  }
  const branch = engine.resolveID(branchName);
  if (branch.get('type') !== 'branch') {
    throw new GitError({
      msg: intl.todo(`${branchName} is not a branch!`),
    });
  }

  const tracking = branch.getRemoteTrackingBranchID();
  if (!tracking) {
    throw new GitError({
      msg: intl.todo(
        `${branchName} is not a remote tracking branch! I don't know where to push`,
      ),
    });
  }
  return tracking;
};

const commandConfig = {
  commit: {
    sc: /^(gc|git ci)($|\s)/,
    regex: /^git +commit($|\s)/,
    options: [
      '--amend',
      '-a',
      '--all',
      '-am',
      '-m',
    ],
    execute(engine, command) {
      const commandOptions = command.getOptionsMap();
      command.acceptNoGeneralArgs();

      if (commandOptions['-am'] && (
        commandOptions['-a'] || commandOptions['--all'] || commandOptions['-m'])) {
        throw new GitError({
          msg: intl.str('git-error-options'),
        });
      }

      let message = null;
      let arguments_ = null;
      if (commandOptions['-a'] || commandOptions['--all']) {
        command.addWarning(intl.str('git-warning-add'));
      }

      if (commandOptions['-am']) {
        arguments_ = commandOptions['-am'];
        command.validateArgBounds(arguments_, 1, 1, '-am');
        message = arguments_[0];
      }

      if (commandOptions['-m']) {
        arguments_ = commandOptions['-m'];
        command.validateArgBounds(arguments_, 1, 1, '-m');
        message = arguments_[0];
      }

      if (commandOptions['--amend']) {
        arguments_ = commandOptions['--amend'];
        command.validateArgBounds(arguments_, 0, 0, '--amend');
      }

      const newCommit = engine.commit({
        isAmend: !!commandOptions['--amend'],
      });
      if (message) {
        message = message
          .replace(/&quot;/g, '"')
          .replace(/^"/g, '')
          .replace(/"$/g, '');

        newCommit.set('commitMessage', message);
      }

      const promise = engine.animationFactory.playCommitBirthPromiseAnimation(
        newCommit,
        engine.gitVisuals,
      );
      engine.animationQueue.thenFinish(promise);
    },
  },

  cherrypick: {
    displayName: 'cherry-pick',
    regex: /^git +cherry-pick($|\s)/,
    execute(engine, command) {
      const commandOptions = command.getOptionsMap();
      const generalArguments = command.getGeneralArgs();

      command.validateArgBounds(generalArguments, 1, Number.MAX_VALUE);

      const set = Graph.getUpstreamSet(engine, 'HEAD');
      // first resolve all the refs (as an error check)
      const toCherrypick = generalArguments.map((argument) => {
        const commit = engine.getCommitFromRef(argument);
        // and check that its not upstream
        if (set[commit.get('id')]) {
          throw new GitError({
            msg: intl.str(
              'git-error-already-exists',
              { commit: commit.get('id') },
            ),
          });
        }
        return commit;
      }, this);

      engine.setupCherrypickChain(toCherrypick);
    },
  },

  pull: {
    regex: /^git +pull($|\s)/,
    options: [
      '--rebase',
    ],
    execute(engine, command) {
      if (!engine.hasOrigin()) {
        throw new GitError({
          msg: intl.str('git-error-origin-required'),
        });
      }

      const commandOptions = command.getOptionsMap();
      const generalArguments = command.getGeneralArgs();
      command.twoArgsForOrigin(generalArguments);
      assertOriginSpecified(generalArguments);
      // here is the deal -- git pull is pretty complex with
      // the arguments it wants. You can
      //   A) specify the remote branch you want to
      //      merge & fetch, in which case it completely
      //      ignores the properties of branch you are on, or
      //
      //  B) specify no args, in which case it figures out
      //     the branch to fetch from the remote tracking
      //     and merges those in, or
      //
      //  C) specify the colon refspec like fetch, where it does
      //     the fetch and then just merges the dest

      let source;
      let destination;
      const firstArgument = generalArguments[1];
      // COPY PASTA validation code from fetch. maybe fix this?
      if (firstArgument && isColonRefspec(firstArgument)) {
        const refspecParts = firstArgument.split(':');
        source = refspecParts[0];
        destination = validateBranchNameIfNeeded(
          engine,
          crappyUnescape(refspecParts[1]),
        );
        assertNotCheckedOut(engine, destination);
      } else if (firstArgument) {
        source = firstArgument;
        assertIsBranch(engine.origin, source);
        // get o/master locally if master is specified
        destination = engine.origin.resolveID(source).getPrefixedID();
      } else {
        // can't be detached
        if (engine.getDetachedHead()) {
          throw new GitError({
            msg: intl.todo('Git pull can not be executed in detached HEAD mode if no remote branch specified!'),
          });
        }
        // ok we need to get our currently checked out branch
        // and then specify source and dest
        const branch = engine.getOneBeforeCommit('HEAD');
        const branchName = branch.get('id');
        assertBranchIsRemoteTracking(engine, branchName);
        destination = branch.getRemoteTrackingBranchID();
        source = destination.replace(ORIGIN_PREFIX, '');
      }

      engine.pull({
        source,
        destination,
        isRebase: !!commandOptions['--rebase'],
      });
    },
  },

  fakeTeamwork: {
    regex: /^git +fakeTeamwork($|\s)/,
    execute(engine, command) {
      const generalArguments = command.getGeneralArgs();
      if (!engine.hasOrigin()) {
        throw new GitError({
          msg: intl.str('git-error-origin-required'),
        });
      }

      command.validateArgBounds(generalArguments, 0, 2);
      let branch;
      let numberToMake;

      // allow formats of: git fakeTeamwork 2 or git fakeTeamwork side 3
      switch (generalArguments.length) {
        // git fakeTeamwork
        case 0:
          branch = 'master';
          numberToMake = 1;
          break;

        // git fakeTeamwork 10 or git fakeTeamwork foo
        case 1:
          if (isNaN(Number.parseInt(generalArguments[0], 10))) {
            branch = validateOriginBranchName(engine, generalArguments[0]);
            numberToMake = 1;
          } else {
            numberToMake = Number.parseInt(generalArguments[0], 10);
            branch = 'master';
          }
          break;

        case 2:
          branch = validateOriginBranchName(engine, generalArguments[0]);
          if (isNaN(Number.parseInt(generalArguments[1], 10))) {
            throw new GitError({
              msg: `Bad numeric argument: ${generalArguments[1]}`,
            });
          }
          numberToMake = Number.parseInt(generalArguments[1], 10);
          break;
      }

      // make sure its a branch and exists
      const destinationBranch = engine.origin.resolveID(branch);
      if (destinationBranch.get('type') !== 'branch') {
        throw new GitError({
          msg: intl.str('git-error-options'),
        });
      }

      engine.fakeTeamwork(numberToMake, branch);
    },
  },

  clone: {
    regex: /^git +clone *?$/,
    execute(engine, command) {
      command.acceptNoGeneralArgs();
      engine.makeOrigin(engine.printTree());
    },
  },

  remote: {
    regex: /^git +remote($|\s)/,
    options: [
      '-v',
    ],
    execute(engine, command) {
      command.acceptNoGeneralArgs();
      if (!engine.hasOrigin()) {
        throw new CommandResult({
          msg: '',
        });
      }

      engine.printRemotes({
        verbose: !!command.getOptionsMap()['-v'],
      });
    },
  },

  fetch: {
    regex: /^git +fetch($|\s)/,
    execute(engine, command) {
      if (!engine.hasOrigin()) {
        throw new GitError({
          msg: intl.str('git-error-origin-required'),
        });
      }

      let source;
      let destination;
      const generalArguments = command.getGeneralArgs();
      command.twoArgsForOrigin(generalArguments);
      assertOriginSpecified(generalArguments);

      const firstArgument = generalArguments[1];
      if (firstArgument && isColonRefspec(firstArgument)) {
        const refspecParts = firstArgument.split(':');
        source = refspecParts[0];
        destination = validateBranchNameIfNeeded(
          engine,
          crappyUnescape(refspecParts[1]),
        );
        assertNotCheckedOut(engine, destination);
      } else if (firstArgument) {
        // here is the deal -- its JUST like git push. the first arg
        // is used as both the destination and the source, so we need
        // to make sure it exists as the source on REMOTE. however
        // technically we have a destination here as the remote branch
        source = firstArgument;
        assertIsBranch(engine.origin, source);
        // get o/master locally if master is specified
        destination = engine.origin.resolveID(source).getPrefixedID();
      }
      if (source) { // empty string fails this check
        assertIsReference(engine.origin, source);
      }

      engine.fetch({
        source,
        destination,
      });
    },
  },

  branch: {
    sc: /^(gb|git br)($|\s)/,
    regex: /^git +branch($|\s)/,
    options: [
      '-d',
      '-D',
      '-f',
      '--force',
      '-a',
      '-r',
      '-u',
      '--contains',
    ],
    execute(engine, command) {
      const commandOptions = command.getOptionsMap();
      const generalArguments = command.getGeneralArgs();

      let arguments_ = null;
      // handle deletion first
      if (commandOptions['-d'] || commandOptions['-D']) {
        let names = commandOptions['-d'] || commandOptions['-D'];
        names = names.concat(generalArguments);
        command.validateArgBounds(names, 1, Number.MAX_VALUE, '-d');

        for (const name of names) {
          engine.validateAndDeleteBranch(name);
        }
        return;
      }

      if (commandOptions['-u']) {
        arguments_ = commandOptions['-u'].concat(generalArguments);
        command.validateArgBounds(arguments_, 1, 2, '-u');
        const remoteBranch = crappyUnescape(arguments_[0]);
        const branch = arguments_[1] || engine.getOneBeforeCommit('HEAD').get('id');

        // some assertions, both of these have to exist first
        assertIsRemoteBranch(engine, remoteBranch);
        assertIsBranch(engine, branch);
        engine.setLocalToTrackRemote(
          engine.resolveID(branch),
          engine.resolveID(remoteBranch),
        );
        return;
      }

      if (commandOptions['--contains']) {
        arguments_ = commandOptions['--contains'];
        command.validateArgBounds(arguments_, 1, 1, '--contains');
        engine.printBranchesWithout(arguments_[0]);
        return;
      }

      if (commandOptions['-f'] || commandOptions['--force']) {
        arguments_ = commandOptions['-f'] || commandOptions['--force'];
        arguments_ = arguments_.concat(generalArguments);
        command.twoArgsImpliedHead(arguments_, '-f');

        // we want to force a branch somewhere
        engine.forceBranch(arguments_[0], arguments_[1]);
        return;
      }

      if (generalArguments.length === 0) {
        let branches;
        if (commandOptions['-a']) {
          branches = engine.getBranches();
        } else if (commandOptions['-r']) {
          branches = engine.getRemoteBranches();
        } else {
          branches = engine.getLocalBranches();
        }
        engine.printBranches(branches);
        return;
      }

      command.twoArgsImpliedHead(generalArguments);
      engine.branch(generalArguments[0], generalArguments[1]);
    },
  },

  add: {
    dontCountForGolf: true,
    sc: /^ga($|\s)/,
    regex: /^git +add($|\s)/,
    execute() {
      throw new CommandResult({
        msg: intl.str('git-error-staging'),
      });
    },
  },

  reset: {
    regex: /^git +reset($|\s)/,
    options: [
      '--hard',
      '--soft',
    ],
    execute(engine, command) {
      const commandOptions = command.getOptionsMap();
      let generalArguments = command.getGeneralArgs();

      if (commandOptions['--soft']) {
        throw new GitError({
          msg: intl.str('git-error-staging'),
        });
      }
      if (commandOptions['--hard']) {
        command.addWarning(
          intl.str('git-warning-hard'),
        );
        // don't absorb the arg off of --hard
        generalArguments = generalArguments.concat(commandOptions['--hard']);
      }

      command.validateArgBounds(generalArguments, 1, 1);

      if (engine.getDetachedHead()) {
        throw new GitError({
          msg: intl.str('git-error-reset-detached'),
        });
      }

      engine.reset(generalArguments[0]);
    },
  },

  revert: {
    regex: /^git +revert($|\s)/,
    execute(engine, command) {
      const generalArguments = command.getGeneralArgs();

      command.validateArgBounds(generalArguments, 1, Number.MAX_VALUE);
      engine.revert(generalArguments);
    },
  },

  merge: {
    regex: /^git +merge($|\s)/,
    options: [
      '--no-ff',
    ],
    execute(engine, command) {
      const commandOptions = command.getOptionsMap();
      const generalArguments = command.getGeneralArgs().concat(commandOptions['--no-ff'] || []);
      command.validateArgBounds(generalArguments, 1, 1);

      const newCommit = engine.merge(
        generalArguments[0],
        { noFF: !!commandOptions['--no-ff'] },
      );

      if (newCommit === undefined) {
        // its just a fast forward
        engine.animationFactory.refreshTree(
          engine.animationQueue, engine.gitVisuals,
        );
        return;
      }

      engine.animationFactory.genCommitBirthAnimation(
        engine.animationQueue, newCommit, engine.gitVisuals,
      );
    },
  },

  revlist: {
    dontCountForGolf: true,
    displayName: 'rev-list',
    regex: /^git +rev-list($|\s)/,
    execute(engine, command) {
      const generalArguments = command.getGeneralArgs();
      command.validateArgBounds(generalArguments, 1);

      engine.revlist(generalArguments);
    },
  },

  log: {
    dontCountForGolf: true,
    regex: /^git +log($|\s)/,
    execute(engine, command) {
      const generalArguments = command.getGeneralArgs();

      command.impliedHead(generalArguments, 0);
      engine.log(generalArguments);
    },
  },

  show: {
    dontCountForGolf: true,
    regex: /^git +show($|\s)/,
    execute(engine, command) {
      const generalArguments = command.getGeneralArgs();
      command.oneArgImpliedHead(generalArguments);
      engine.show(generalArguments[0]);
    },
  },

  rebase: {
    sc: /^gr($|\s)/,
    options: [
      '-i',
      '--solution-ordering',
      '--interactive-test',
      '--aboveAll',
      '-p',
      '--preserve-merges',
    ],
    regex: /^git +rebase($|\s)/,
    execute(engine, command) {
      const commandOptions = command.getOptionsMap();
      const generalArguments = command.getGeneralArgs();

      if (commandOptions['-i']) {
        const arguments_ = commandOptions['-i'].concat(generalArguments);
        command.twoArgsImpliedHead(arguments_, ' -i');

        if (commandOptions['--interactive-test']) {
          engine.rebaseInteractiveTest(
            arguments_[0],
            arguments_[1], {
              interactiveTest: commandOptions['--interactive-test'],
            },
          );
        } else {
          engine.rebaseInteractive(
            arguments_[0],
            arguments_[1], {
              aboveAll: !!commandOptions['--aboveAll'],
              initialCommitOrdering: commandOptions['--solution-ordering'],
            },
          );
        }
        return;
      }

      command.twoArgsImpliedHead(generalArguments);
      engine.rebase(generalArguments[0], generalArguments[1], {
        preserveMerges: commandOptions['-p'] || commandOptions['--preserve-merges'],
      });
    },
  },

  status: {
    dontCountForGolf: true,
    sc: /^(gst|gs|git st)($|\s)/,
    regex: /^git +status($|\s)/,
    execute(engine) {
      // no parsing at all
      engine.status();
    },
  },

  checkout: {
    sc: /^(go|git co)($|\s)/,
    regex: /^git +checkout($|\s)/,
    options: [
      '-b',
      '-B',
      '-',
    ],
    execute(engine, command) {
      const commandOptions = command.getOptionsMap();
      const generalArguments = command.getGeneralArgs();

      let arguments_ = null;
      if (commandOptions['-b']) {
        // the user is really trying to just make a
        // branch and then switch to it. so first:
        arguments_ = commandOptions['-b'].concat(generalArguments);
        command.twoArgsImpliedHead(arguments_, '-b');

        const validId = engine.validateBranchName(arguments_[0]);
        engine.branch(validId, arguments_[1]);
        engine.checkout(validId);
        return;
      }

      if (commandOptions['-']) {
        // get the heads last location
        const lastPlace = engine.HEAD.get('lastLastTarget');
        if (!lastPlace) {
          throw new GitError({
            msg: intl.str('git-result-nothing'),
          });
        }
        engine.HEAD.set('target', lastPlace);
        return;
      }

      if (commandOptions['-B']) {
        arguments_ = commandOptions['-B'].concat(generalArguments);
        command.twoArgsImpliedHead(arguments_, '-B');

        engine.forceBranch(arguments_[0], arguments_[1]);
        engine.checkout(arguments_[0]);
        return;
      }

      command.validateArgBounds(generalArguments, 1, 1);

      engine.checkout(engine.crappyUnescape(generalArguments[0]));
    },
  },

  push: {
    regex: /^git +push($|\s)/,
    options: [
      '--force',
    ],
    execute(engine, command) {
      if (!engine.hasOrigin()) {
        throw new GitError({
          msg: intl.str('git-error-origin-required'),
        });
      }

      const options = {};
      let destination;
      let source;
      let sourceObject;
      const commandOptions = command.getOptionsMap();

      // git push is pretty complex in terms of
      // the arguments it wants as well... get ready!
      const generalArguments = command.getGeneralArgs();
      command.twoArgsForOrigin(generalArguments);
      assertOriginSpecified(generalArguments);

      const firstArgument = generalArguments[1];
      if (firstArgument && isColonRefspec(firstArgument)) {
        const refspecParts = firstArgument.split(':');
        source = refspecParts[0];
        destination = validateBranchName(engine, refspecParts[1]);
        if (source === '' && !engine.origin.resolveID(destination)) {
          throw new GitError({
            msg: intl.todo(
              `cannot delete branch ${options.destination} which doesnt exist`,
            ),
          });
        }
      } else {
        if (firstArgument) {
          // we are using this arg as destination AND source. the dest branch
          // can be created on demand but we at least need this to be a source
          // locally otherwise we will fail
          assertIsReference(engine, firstArgument);
          sourceObject = engine.resolveID(firstArgument);
        } else {
          // since they have not specified a source or destination, then
          // we source from the branch we are on (or HEAD)
          sourceObject = engine.getOneBeforeCommit('HEAD');
        }
        source = sourceObject.get('id');

        // HOWEVER we push to either the remote tracking branch we have
        // OR a new named branch if we aren't tracking anything
        if (sourceObject.getRemoteTrackingBranchID
            && sourceObject.getRemoteTrackingBranchID()) {
          assertBranchIsRemoteTracking(engine, source);
          const remoteBranch = sourceObject.getRemoteTrackingBranchID();
          destination = engine.resolveID(remoteBranch).getBaseID();
        } else {
          destination = validateBranchName(engine, source);
        }
      }
      if (source) {
        assertIsReference(engine, source);
      }

      engine.push({
        // NOTE -- very important! destination and source here
        // are always, always strings. very important :D
        destination,
        source,
        force: !!commandOptions['--force'],
      });
    },
  },

  describe: {
    regex: /^git +describe($|\s)/,
    execute(engine, command) {
      // first if there are no tags, we cant do anything so just throw
      if (engine.tagCollection.toArray().length === 0) {
        throw new GitError({
          msg: intl.todo(
            'fatal: No tags found, cannot describe anything.',
          ),
        });
      }

      const generalArguments = command.getGeneralArgs();
      command.oneArgImpliedHead(generalArguments);
      assertIsReference(engine, generalArguments[0]);

      engine.describe(generalArguments[0]);
    },
  },

  tag: {
    regex: /^git +tag($|\s)/,
    options: [
      '-d',
    ],
    execute(engine, command) {
      const generalArguments = command.getGeneralArgs();
      const commandOptions = command.getOptionsMap();

      if (commandOptions['-d']) {
        const tagID = commandOptions['-d'];
        let tagToRemove;

        assertIsReference(engine, tagID);

        command.oneArgImpliedHead(tagID);
        engine.tagCollection.each((tag) => {
          if (tag.get('id') == tagID) {
            tagToRemove = tag;
          }
        }, true);

        if (tagToRemove == undefined) {
          throw new GitError({
            msg: intl.todo(
              'No tag found, nothing to remove',
            ),
          });
        }

        engine.tagCollection.remove(tagToRemove);
        delete engine.refs[tagID];

        engine.gitVisuals.refreshTree();
        return;
      }

      if (generalArguments.length === 0) {
        const tags = engine.getTags();
        engine.printTags(tags);
        return;
      }

      command.twoArgsImpliedHead(generalArguments);
      engine.tag(generalArguments[0], generalArguments[1]);
    },
  },

  switch: {
    sc: /^(gsw|git sw)($|\s)/,
    regex: /^git +switch($|\s)/,
    options: [
      '-c',
      '-',
    ],
    execute(engine, command) {
      const generalArguments = command.getGeneralArgs();
      const commandOptions = command.getOptionsMap();

      let arguments_ = null;
      if (commandOptions['-c']) {
        // the user is really trying to just make a
        // branch and then switch to it. so first:
        arguments_ = commandOptions['-c'].concat(generalArguments);
        command.twoArgsImpliedHead(arguments_, '-c');

        const validId = engine.validateBranchName(arguments_[0]);
        engine.branch(validId, arguments_[1]);
        engine.checkout(validId);
        return;
      }

      if (commandOptions['-']) {
        // get the heads last location
        const lastPlace = engine.HEAD.get('lastLastTarget');
        if (!lastPlace) {
          throw new GitError({
            msg: intl.str('git-result-nothing'),
          });
        }
        engine.HEAD.set('target', lastPlace);
        return;
      }

      command.validateArgBounds(generalArguments, 1, 1);

      engine.checkout(engine.crappyUnescape(generalArguments[0]));
    },
  },
};

const instantCommands = [
  [/^(git help($|\s)|git$)/, function () {
    const lines = [
      intl.str('git-version'),
      '<br/>',
      intl.str('git-usage'),
      escapeString(intl.str('git-usage-command')),
      '<br/>',
      intl.str('git-supported-commands'),
      '<br/>',
    ];

    const commands = require('../commands').commands.getOptionMap().git;
    // build up a nice display of what we support
    Object.keys(commands).forEach(function (command) {
      const commandOptions = commands[command];
      lines.push(`git ${command}`);
      Object.keys(commandOptions).forEach((optionName) => {
        lines.push(`\t ${optionName}`);
      }, this);
    }, this);

    // format and throw
    let message = lines.join('\n');
    message = message.replace(/\t/g, '&nbsp;&nbsp;&nbsp;');
    throw new CommandResult({
      msg: message,
    });
  }],
];

exports.commandConfig = commandConfig;
exports.instantCommands = instantCommands;
