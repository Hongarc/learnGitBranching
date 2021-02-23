const Backbone = require('backbone');
const Q = require('q');

const intl = require('../intl');

const { AnimationFactory } = require('../visuals/animation/animationFactory');
const { AnimationQueue } = require('../visuals/animation');
const TreeCompare = require('../graph/treeCompare');

const Graph = require('../graph');
const Errors = require('../util/errors');
const Main = require('../app');
const Commands = require('../commands');

const { GitError } = Errors;
const { CommandResult } = Errors;

const ORIGIN_PREFIX = 'o/';
const TAB = '&nbsp;&nbsp;&nbsp;';
const SHORT_CIRCUIT_CHAIN = 'STAPH';

function catchShortCircuit(error) {
  if (error !== SHORT_CIRCUIT_CHAIN) {
    throw error;
  }
}

function GitEngine(options) {
  this.rootCommit = null;
  this.refs = {};
  this.HEAD = null;
  this.origin = null;
  this.mode = 'git';
  this.localRepo = null;

  this.branchCollection = options.branches;
  this.tagCollection = options.tags;
  this.commitCollection = options.collection;
  this.gitVisuals = options.gitVisuals;

  this.eventBaton = options.eventBaton;
  this.eventBaton.stealBaton('processGitCommand', this.dispatch, this);

  // poor man's dependency injection. we can't reassign
  // the module variable because its get clobbered :P
  this.animationFactory = (options.animationFactory)
    ? options.animationFactory : AnimationFactory;

  this.initUniqueID();
}

GitEngine.prototype.initUniqueID = function () {
  // backbone or something uses _ .uniqueId, so we make our own here
  this.uniqueId = (function () {
    let n = 0;
    return function (prepend) {
      return prepend ? prepend + n++ : n++;
    };
  }());
};

GitEngine.prototype.handleModeChange = function (vcs, callback) {
  if (this.mode === vcs) {
    // don't fire event aggressively
    callback();
    return;
  }
  Main.getEvents().trigger('vcsModeChange', { mode: vcs });
  const chain = this.setMode(vcs);
  if (this.origin) {
    this.origin.setMode(vcs, () => {});
  }

  if (!chain) {
    callback();
    return;
  }
  // we have to do it async
  chain.then(callback);
};

GitEngine.prototype.getIsHg = function () {
  return this.mode === 'hg';
};

GitEngine.prototype.setMode = function (vcs) {
  const switchedToHg = (this.mode === 'git' && vcs === 'hg');
  this.mode = vcs;
  if (!switchedToHg) {
    return;
  }
  // if we are switching to mercurial then we have some
  // garbage collection and other tidying up to do. this
  // may or may not require a refresh so lets check.
  const deferred = Q.defer();
  deferred.resolve();
  let chain = deferred.promise;

  // this stuff is tricky because we don't animate when
  // we didn't do anything, but we DO animate when
  // either of the operations happen. so a lot of
  // branching ahead...
  const neededUpdate = this.updateAllBranchesForHg();
  if (neededUpdate) {
    chain = chain.then(() => this.animationFactory.playRefreshAnimationSlow(this.gitVisuals));

    // ok we need to refresh anyways, so do the prune after
    chain = chain.then(() => {
      const neededPrune = this.pruneTree();
      if (!neededPrune) {
        return;
      }
      return this.animationFactory.playRefreshAnimation(this.gitVisuals);
    });

    return chain;
  }

  // ok might need prune though
  const pruned = this.pruneTree();
  if (!pruned) {
    // do sync
    return;
  }

  return this.animationFactory.playRefreshAnimation(this.gitVisuals);
};

GitEngine.prototype.assignLocalRepo = function (repo) {
  this.localRepo = repo;
};

GitEngine.prototype.defaultInit = function () {
  const defaultTree = Graph.getDefaultTree();
  this.loadTree(defaultTree);
};

GitEngine.prototype.init = function () {
  // make an initial commit and a master branch
  this.rootCommit = this.makeCommit(null, null, { rootCommit: true });
  this.commitCollection.add(this.rootCommit);

  const master = this.makeBranch('master', this.rootCommit);
  this.HEAD = new Reference({
    id: 'HEAD',
    target: master,
  });
  this.refs[this.HEAD.get('id')] = this.HEAD;

  // commit once to get things going
  this.commit();
};

GitEngine.prototype.hasOrigin = function () {
  return !!this.origin;
};

GitEngine.prototype.isOrigin = function () {
  return !!this.localRepo;
};

GitEngine.prototype.exportTreeForBranch = function (branchName) {
  // this method exports the tree and then prunes everything that
  // is not connected to branchname
  const tree = this.exportTree();
  // get the upstream set
  const set = Graph.getUpstreamSet(this, branchName);
  // now loop through and delete commits
  const commitsToLoop = tree.commits;
  tree.commits = {};
  for (const [id, commit] of commitsToLoop.entries()) {
    if (set[id]) {
      // if included in target branch
      tree.commits[id] = commit;
    }
  }

  const branchesToLoop = tree.branches;
  tree.branches = {};
  for (const [id, branch] of branchesToLoop.entries()) {
    if (id === branchName) {
      tree.branches[id] = branch;
    }
  }

  tree.HEAD.target = branchName;
  return tree;
};

GitEngine.prototype.exportTree = function () {
  // need to export all commits, their connectivity / messages, branches, and state of head.
  // this would be simple if didn't have circular structures.... :P
  // thus, we need to loop through and "flatten" our graph of objects referencing one another
  const totalExport = {
    branches: {},
    commits: {},
    tags: {},
    HEAD: null,
  };

  for (const branch of this.branchCollection.toJSON()) {
    branch.target = branch.target.get('id');
    delete branch.visBranch;

    totalExport.branches[branch.id] = branch;
  }

  this.commitCollection.toJSON().forEach((commit) => {
    // clear out the fields that reference objects and create circular structure
    for (const field of Commit.prototype.constants.circularFields) {
      delete commit[field];
    }

    // convert parents
    commit.parents = (commit.parents || []).map((par) => par.get('id'));

    totalExport.commits[commit.id] = commit;
  }, this);

  this.tagCollection.toJSON().forEach((tag) => {
    delete tag.visTag;
    tag.target = tag.target.get('id');

    totalExport.tags[tag.id] = tag;
  }, this);

  const HEAD = this.HEAD.toJSON();
  HEAD.lastTarget = HEAD.lastLastTarget = HEAD.visBranch = HEAD.visTag = undefined;
  HEAD.target = HEAD.target.get('id');
  totalExport.HEAD = HEAD;

  if (this.hasOrigin()) {
    totalExport.originTree = this.origin.exportTree();
  }

  return totalExport;
};

GitEngine.prototype.printTree = function (tree) {
  tree = tree || this.exportTree();
  TreeCompare.reduceTreeFields([tree]);

  let string = JSON.stringify(tree);
  if (/'/.test(string)) {
    // escape it to make it more copy paste friendly
    string = escape(string);
  }
  return string;
};

GitEngine.prototype.printAndCopyTree = function () {
  window.prompt(
    intl.str('Copy the tree string below'),
    this.printTree(),
  );
};

GitEngine.prototype.loadTree = function (tree) {
  // deep copy in case we use it a bunch. lol awesome copy method
  tree = JSON.parse(JSON.stringify(tree));

  // first clear everything
  this.removeAll();

  this.instantiateFromTree(tree);

  this.reloadGraphics();
  this.initUniqueID();
};

GitEngine.prototype.loadTreeFromString = function (treeString) {
  this.loadTree(JSON.parse(unescape(this.crappyUnescape(treeString))));
};

GitEngine.prototype.instantiateFromTree = function (tree) {
  // now we do the loading part
  const createdSoFar = {};

  Object.values(tree.commits).forEach(function (commitJSON) {
    const commit = this.getOrMakeRecursive(tree, createdSoFar, commitJSON.id, this.gitVisuals);
    this.commitCollection.add(commit);
  }, this);

  Object.values(tree.branches).forEach(function (branchJSON) {
    const branch = this.getOrMakeRecursive(tree, createdSoFar, branchJSON.id, this.gitVisuals);

    this.branchCollection.add(branch, { silent: true });
  }, this);

  Object.values(tree.tags || {}).forEach(function (tagJSON) {
    const tag = this.getOrMakeRecursive(tree, createdSoFar, tagJSON.id, this.gitVisuals);

    this.tagCollection.add(tag, { silent: true });
  }, this);

  const HEAD = this.getOrMakeRecursive(tree, createdSoFar, tree.HEAD.id, this.gitVisuals);
  this.HEAD = HEAD;

  this.rootCommit = createdSoFar.C0;
  if (!this.rootCommit) {
    throw new Error('Need root commit of C0 for calculations');
  }
  this.refs = createdSoFar;

  this.gitVisuals.gitReady = false;
  this.branchCollection.each(function (branch) {
    this.gitVisuals.addBranch(branch);
  }, this);
  this.tagCollection.each(function (tag) {
    this.gitVisuals.addTag(tag);
  }, this);

  if (tree.originTree) {
    const treeString = JSON.stringify(tree.originTree);
    // if we don't have an animation queue (like when loading
    // right away), just go ahead and make an empty one
    this.animationQueue = this.animationQueue || new AnimationQueue({
      callback() {},
    });
    this.makeOrigin(treeString);
  }
};

GitEngine.prototype.makeOrigin = function (treeString) {
  if (this.hasOrigin()) {
    throw new GitError({
      msg: intl.str('git-error-origin-exists'),
    });
  }
  treeString = treeString || this.printTree(this.exportTreeForBranch('master'));

  // this is super super ugly but a necessary hack because of the way LGB was
  // originally designed. We need to get to the top level visualization from
  // the git engine -- aka we need to access our own visuals, then the
  // visualization and ask the main vis to create a new vis/git pair. Then
  // we grab the gitengine out of that and assign that as our origin repo
  // which connects the two. epic
  const masterVis = this.gitVisuals.getVisualization();
  const originVis = masterVis.makeOrigin({
    localRepo: this,
    treeString,
  });

  // defer the starting of our animation until origin has been created
  this.animationQueue.set('promiseBased', true);
  originVis.customEvents.on('gitEngineReady', function () {
    this.origin = originVis.gitEngine;
    originVis.gitEngine.assignLocalRepo(this);
    this.syncRemoteBranchFills();
    // and then here is the crazy part -- we need the ORIGIN to refresh
    // itself in a separate animation. @_____@
    this.origin.externalRefresh();
    this.animationFactory.playRefreshAnimationAndFinish(this.gitVisuals, this.animationQueue);
  }, this);

  const originTree = JSON.parse(unescape(treeString));
  // make an origin branch for each branch mentioned in the tree if its
  // not made already...
  Object.keys(originTree.branches).forEach(function (branchName) {
    const branchJSON = originTree.branches[branchName];
    if (this.refs[ORIGIN_PREFIX + branchName]) {
      // we already have this branch
      return;
    }

    const originTarget = this.findCommonAncestorWithRemote(
      branchJSON.target,
    );

    // now we have something in common, lets make the tracking branch
    const remoteBranch = this.makeBranch(
      ORIGIN_PREFIX + branchName,
      this.getCommitFromRef(originTarget),
    );

    this.setLocalToTrackRemote(this.refs[branchJSON.id], remoteBranch);
  }, this);
};

GitEngine.prototype.makeRemoteBranchIfNeeded = function (branchName) {
  if (this.doesRefExist(ORIGIN_PREFIX + branchName)) {
    return;
  }
  // if its not a branch on origin then bounce
  const source = this.origin.resolveID(branchName);
  if (source.get('type') !== 'branch') {
    return;
  }

  return this.makeRemoteBranchForRemote(branchName);
};

GitEngine.prototype.makeBranchIfNeeded = function (branchName) {
  if (this.doesRefExist(branchName)) {
    return;
  }
  const where = this.findCommonAncestorForRemote(
    this.getCommitFromRef('HEAD').get('id'),
  );

  return this.validateAndMakeBranch(branchName, this.getCommitFromRef(where));
};

GitEngine.prototype.makeRemoteBranchForRemote = function (branchName) {
  const target = this.origin.resolveID(branchName).get('target');
  const originTarget = this.findCommonAncestorWithRemote(
    target.get('id'),
  );
  return this.makeBranch(
    ORIGIN_PREFIX + branchName,
    this.getCommitFromRef(originTarget),
  );
};

GitEngine.prototype.findCommonAncestorForRemote = function (myTarget) {
  if (this.origin.refs[myTarget]) {
    return myTarget;
  }
  const parents = this.refs[myTarget].get('parents');
  if (parents.length === 1) {
    // Easy, we only have one parent. lets just go upwards
    myTarget = parents[0].get('id');
    // Recurse upwards to find where our remote has a commit.
    return this.findCommonAncestorForRemote(myTarget);
  }
  // We have multiple parents so find out where these two meet.
  const leftTarget = this.findCommonAncestorForRemote(parents[0].get('id'));
  const rightTarget = this.findCommonAncestorForRemote(parents[1].get('id'));
  return this.getCommonAncestor(
    leftTarget,
    rightTarget,
    true, // don't throw since we don't know the order here.
  ).get('id');
};

GitEngine.prototype.findCommonAncestorWithRemote = function (originTarget) {
  if (this.refs[originTarget]) {
    return originTarget;
  }
  // now this is tricky -- our remote could have commits that we do
  // not have. so lets go upwards until we find one that we have
  const parents = this.origin.refs[originTarget].get('parents');
  if (parents.length === 1) {
    return this.findCommonAncestorWithRemote(parents[0].get('id'));
  }
  // Like above, could have two parents
  const leftTarget = this.findCommonAncestorWithRemote(parents[0].get('id'));
  const rightTarget = this.findCommonAncestorWithRemote(parents[1].get('id'));
  return this.getCommonAncestor(leftTarget, rightTarget, true /* don't throw */).get('id');
};

GitEngine.prototype.makeBranchOnOriginAndTrack = function (branchName, target) {
  const remoteBranch = this.makeBranch(
    ORIGIN_PREFIX + branchName,
    this.getCommitFromRef(target),
  );

  if (this.refs[branchName]) { // not all remote branches have tracking ones
    this.setLocalToTrackRemote(this.refs[branchName], remoteBranch);
  }

  const originTarget = this.findCommonAncestorForRemote(
    this.getCommitFromRef(target).get('id'),
  );
  this.origin.makeBranch(
    branchName,
    this.origin.getCommitFromRef(originTarget),
  );
};

GitEngine.prototype.setLocalToTrackRemote = function (localBranch, remoteBranch) {
  localBranch.setRemoteTrackingBranchID(remoteBranch.get('id'));

  if (!this.command) {
    // during init we have no command
    return;
  }

  const message = `local branch "${
    this.postProcessBranchID(localBranch.get('id'))
  }" set to track remote branch "${
    this.postProcessBranchID(remoteBranch.get('id'))
  }"`;
  this.command.addWarning(intl.todo(message));
};

GitEngine.prototype.getOrMakeRecursive = function (
  tree,
  createdSoFar,
  objectID,
  gitVisuals,
) {
  if (createdSoFar[objectID]) {
    // base case
    return createdSoFar[objectID];
  }

  const getType = function (tree, id) {
    if (tree.commits[id]) {
      return 'commit';
    } if (tree.branches[id]) {
      return 'branch';
    } if (id == 'HEAD') {
      return 'HEAD';
    } if (tree.tags[id]) {
      return 'tag';
    }
    throw new Error(`bad type for ${id}`);
  };

  // figure out what type
  const type = getType(tree, objectID);

  if (type == 'HEAD') {
    const headJSON = tree.HEAD;
    const HEAD = new Reference(Object.assign(
      tree.HEAD,
      {
        target: this.getOrMakeRecursive(tree, createdSoFar, headJSON.target),
      },
    ));
    createdSoFar[objectID] = HEAD;
    return HEAD;
  }

  if (type == 'branch') {
    const branchJSON = tree.branches[objectID];

    const branch = new Branch(Object.assign(
      tree.branches[objectID],
      {
        target: this.getOrMakeRecursive(tree, createdSoFar, branchJSON.target),
      },
    ));
    createdSoFar[objectID] = branch;
    return branch;
  }

  if (type == 'tag') {
    const tagJSON = tree.tags[objectID];

    const tag = new Tag(Object.assign(
      tree.tags[objectID],
      {
        target: this.getOrMakeRecursive(tree, createdSoFar, tagJSON.target),
      },
    ));
    createdSoFar[objectID] = tag;
    return tag;
  }

  if (type == 'commit') {
    // for commits, we need to grab all the parents
    const commitJSON = tree.commits[objectID];

    const parentObjs = commitJSON.parents.map(function (parentID) {
      return this.getOrMakeRecursive(tree, createdSoFar, parentID);
    }, this);

    const commit = new Commit(Object.assign(
      commitJSON,
      {
        parents: parentObjs,
        gitVisuals: this.gitVisuals,
      },
    ));
    createdSoFar[objectID] = commit;
    return commit;
  }

  throw new Error(`ruh rho!! unsupported type for ${objectID}`);
};

GitEngine.prototype.tearDown = function () {
  if (this.tornDown) {
    return;
  }
  this.eventBaton.releaseBaton('processGitCommand', this.dispatch, this);
  this.removeAll();
  this.tornDown = true;
};

GitEngine.prototype.reloadGraphics = function () {
  // get the root commit
  this.gitVisuals.rootCommit = this.refs.C0;
  // this just basically makes the HEAD branch. the head branch really should have been
  // a member of a collection and not this annoying edge case stuff... one day
  this.gitVisuals.initHeadBranch();

  // when the paper is ready
  this.gitVisuals.drawTreeFromReload();

  this.gitVisuals.refreshTreeHarsh();
};

GitEngine.prototype.removeAll = function () {
  this.branchCollection.reset();
  this.tagCollection.reset();
  this.commitCollection.reset();
  this.refs = {};
  this.HEAD = null;
  this.rootCommit = null;

  if (this.origin) {
    // we will restart all this jazz during init from tree
    this.origin.gitVisuals.getVisualization().tearDown();
    delete this.origin;
    this.gitVisuals.getVisualization().clearOrigin();
  }

  this.gitVisuals.resetAll();
};

GitEngine.prototype.getDetachedHead = function () {
  // detached head is if HEAD points to a commit instead of a branch...
  const target = this.HEAD.get('target');
  const targetType = target.get('type');
  return targetType !== 'branch';
};

GitEngine.prototype.validateBranchName = function (name) {
  // Lets escape some of the nasty characters
  name = name.replace(/&#x2F;/g, '\/');
  name = name.replace(/\s/g, '');
  // And then just make sure it starts with alpha-numeric,
  // can contain a slash or dash, and then ends with alpha
  if (
    !/^(\w+[./\-]?)+\w+$/.test(name)
    || name.search('o/') === 0
  ) {
    throw new GitError({
      msg: intl.str(
        'bad-branch-name',
        { branch: name },
      ),
    });
  }
  if (/^[Cc]\d+$/.test(name)) {
    throw new GitError({
      msg: intl.str(
        'bad-branch-name',
        { branch: name },
      ),
    });
  }
  if (/[Hh][Ee][Aa][Dd]/.test(name)) {
    throw new GitError({
      msg: intl.str(
        'bad-branch-name',
        { branch: name },
      ),
    });
  }
  if (name.length > 9) {
    name = name.slice(0, 9);
    this.command.addWarning(
      intl.str(
        'branch-name-short',
        { branch: name },
      ),
    );
  }
  return name;
};

GitEngine.prototype.validateAndMakeBranch = function (id, target) {
  id = this.validateBranchName(id);
  if (this.doesRefExist(id)) {
    throw new GitError({
      msg: intl.str(
        'bad-branch-name',
        { branch: id },
      ),
    });
  }

  return this.makeBranch(id, target);
};

GitEngine.prototype.validateAndMakeTag = function (id, target) {
  id = this.validateBranchName(id);
  if (this.refs[id]) {
    throw new GitError({
      msg: intl.str(
        'bad-tag-name',
        { tag: id },
      ),
    });
  }

  this.makeTag(id, target);
};

GitEngine.prototype.postProcessBranchID = function (id) {
  if (/\bmaster\b/.test(id)) {
    id = id.replace(/\bmaster\b/, 'main');
  }
  return id;
};

GitEngine.prototype.makeBranch = function (id, target) {
  // all main branches are stored as master under the hood
  if (/\bmain\b/.test(id)) {
    id = id.replace(/\bmain\b/, 'master');
  }

  if (this.refs[id]) {
    const error = new Error();
    throw new Error(`woah already have that ref ${id} ${error.stack}`);
  }

  const branch = new Branch({
    target,
    id,
  });
  this.branchCollection.add(branch);
  this.refs[branch.get('id')] = branch;
  return branch;
};

GitEngine.prototype.makeTag = function (id, target) {
  if (this.refs[id]) {
    throw new Error('woah already have that');
  }

  const tag = new Tag({
    target,
    id,
  });
  this.tagCollection.add(tag);
  this.refs[tag.get('id')] = tag;
  return tag;
};

GitEngine.prototype.getHead = function () {
  return { ...this.HEAD };
};

GitEngine.prototype.getTags = function () {
  const toReturn = [];
  this.tagCollection.each((tag) => {
    toReturn.push({
      id: tag.get('id'),
      target: tag.get('target'),
      remote: tag.getIsRemote(),
      obj: tag,
    });
  }, this);
  return toReturn;
};

GitEngine.prototype.getBranches = function () {
  const toReturn = [];
  this.branchCollection.each(function (branch) {
    toReturn.push({
      id: branch.get('id'),
      selected: this.HEAD.get('target') === branch,
      target: branch.get('target'),
      remote: branch.getIsRemote(),
      obj: branch,
    });
  }, this);
  return toReturn;
};

GitEngine.prototype.getRemoteBranches = function () {
  const all = this.getBranches();
  return all.filter((branchJSON) => branchJSON.remote === true);
};

GitEngine.prototype.getLocalBranches = function () {
  const all = this.getBranches();
  return all.filter((branchJSON) => branchJSON.remote === false);
};

GitEngine.prototype.printBranchesWithout = function (without) {
  const commitToBranches = this.getUpstreamBranchSet();
  const commitID = this.getCommitFromRef(without).get('id');

  const toPrint = commitToBranches[commitID].map(function (branchJSON) {
    branchJSON.selected = this.HEAD.get('target').get('id') == branchJSON.id;
    return branchJSON;
  }, this);
  this.printBranches(toPrint);
};

GitEngine.prototype.printBranches = function (branches) {
  let result = '';
  for (const branch of branches) {
    result += `${(branch.selected ? '* ' : '') + branch.id}\n`;
  }
  throw new CommandResult({
    msg: result,
  });
};

GitEngine.prototype.printTags = function (tags) {
  let result = '';
  for (const tag of tags) {
    result += `${tag.id}\n`;
  }
  throw new CommandResult({
    msg: result,
  });
};

GitEngine.prototype.printRemotes = function (options) {
  let result = '';
  if (options.verbose) {
    result += 'origin (fetch)\n';
    result += `${TAB}git@github.com:pcottle/foo.git` + '\n\n';
    result += 'origin (push)\n';
    result += `${TAB}git@github.com:pcottle/foo.git`;
  } else {
    result += 'origin';
  }
  throw new CommandResult({
    msg: result,
  });
};

GitEngine.prototype.getUniqueID = function () {
  let id = this.uniqueId('C');

  const hasID = (idToCheck) => {
    // loop through and see if we have it locally or
    // remotely
    if (this.refs[idToCheck]) {
      return true;
    }
    if (this.origin && this.origin.refs[idToCheck]) {
      return true;
    }
    return false;
  };

  while (hasID(id)) {
    id = this.uniqueId('C');
  }
  return id;
};

GitEngine.prototype.makeCommit = function (parents, id, options) {
  // ok we need to actually manually create commit IDs now because
  // people like nikita (thanks for finding this!) could
  // make branches named C2 before creating the commit C2
  if (!id) {
    id = this.getUniqueID();
  }

  const commit = new Commit({
    parents,
    id,
    gitVisuals: this.gitVisuals,
    ...options || {},
  });

  this.refs[commit.get('id')] = commit;
  this.commitCollection.add(commit);
  return commit;
};

GitEngine.prototype.revert = function (whichCommits) {
  // resolve the commits we will rebase
  const toRevert = whichCommits.map(function (stringReference) {
    return this.getCommitFromRef(stringReference);
  }, this);

  const deferred = Q.defer();
  let chain = deferred.promise;
  const destinationBranch = this.resolveID('HEAD');

  chain = this.animationFactory.highlightEachWithPromise(
    chain,
    toRevert,
    destinationBranch,
  );

  let base = this.getCommitFromRef('HEAD');
  // each step makes a new commit
  const chainStep = (oldCommit) => {
    const newId = this.rebaseAltID(oldCommit.get('id'));
    const commitMessage = intl.str('git-revert-msg', {
      oldCommit: this.resolveName(oldCommit),
      oldMsg: oldCommit.get('commitMessage'),
    });
    const newCommit = this.makeCommit([base], newId, {
      commitMessage,
    });
    base = newCommit;

    return this.animationFactory.playCommitBirthPromiseAnimation(
      newCommit,
      this.gitVisuals,
    );
  };

  // set up the promise chain
  for (const commit of toRevert) {
    chain = chain.then(() => chainStep(commit));
  }

  // done! update our location
  chain = chain.then(() => {
    this.setTargetLocation('HEAD', base);
    return this.animationFactory.playRefreshAnimation(this.gitVisuals);
  });

  this.animationQueue.thenFinish(chain, deferred);
};

GitEngine.prototype.reset = function (target) {
  this.setTargetLocation('HEAD', this.getCommitFromRef(target));
};

GitEngine.prototype.setupCherrypickChain = function (toCherrypick) {
  // error checks are all good, lets go!
  const deferred = Q.defer();
  let chain = deferred.promise;
  const destinationBranch = this.resolveID('HEAD');

  chain = this.animationFactory.highlightEachWithPromise(
    chain,
    toCherrypick,
    destinationBranch,
  );

  const chainStep = (commit) => {
    const newCommit = this.cherrypick(commit);
    return this.animationFactory.playCommitBirthPromiseAnimation(
      newCommit,
      this.gitVisuals,
    );
  };

  toCherrypick.forEach((argument) => {
    chain = chain.then(() => chainStep(argument));
  }, this);

  this.animationQueue.thenFinish(chain, deferred);
};

/** ***********************************
 * Origin stuff!
 *********************************** */

GitEngine.prototype.checkUpstreamOfSource = function (
  target,
  source,
  targetBranch,
  sourceBranch,
  errorMessage,
) {
  // here we are downloading some X number of commits from source onto
  // target. Hence target should be strictly upstream of source

  // lets first get the upstream set from source's dest branch
  const upstream = Graph.getUpstreamSet(source, sourceBranch);

  const targetLocationID = target.getCommitFromRef(targetBranch).get('id');
  if (!upstream[targetLocationID]) {
    throw new GitError({
      msg: errorMessage || intl.str('git-error-origin-fetch-no-ff'),
    });
  }
};

GitEngine.prototype.getTargetGraphDifference = function (
  target,
  source,
  targetBranch,
  sourceBranch,
  options,
) {
  options = options || {};
  sourceBranch = source.resolveID(sourceBranch);

  const targetSet = Graph.getUpstreamSet(target, targetBranch);
  const sourceStartCommit = source.getCommitFromRef(sourceBranch);

  const sourceTree = source.exportTree();
  const sourceStartCommitJSON = sourceTree.commits[sourceStartCommit.get('id')];

  if (targetSet[sourceStartCommitJSON.id]) {
    // either we throw since theres no work to be done, or we return an empty array
    if (options.dontThrowOnNoFetch) {
      return [];
    }
    throw new GitError({
      msg: intl.str('git-error-origin-fetch-uptodate'),
    });
  }

  // ok great, we have our starting point and our stopping set. lets go ahead
  // and traverse upwards and keep track of depth manually
  sourceStartCommitJSON.depth = 0;
  const difference = [];
  const toExplore = [sourceStartCommitJSON];

  const pushParent = function (parentID) {
    if (targetSet[parentID]) {
      // we already have that commit, lets bounce
      return;
    }

    const parentJSON = sourceTree.commits[parentID];
    parentJSON.depth = here.depth + 1;
    toExplore.push(parentJSON);
  };

  while (toExplore.length > 0) {
    var here = toExplore.pop();
    difference.push(here);
    here.parents.forEach(pushParent);
  }

  // filter because we weren't doing graph search
  const differenceUnique = Graph.getUniqueObjects(difference);
  /**
   * Ok now we have to determine the order in which to make these commits.
   * We used to just sort by depth because we were lazy but that is incorrect
   * since it doesn't represent the actual dependency tree of the commits.
   *
   * So here is what we are going to do -- loop through the differenceUnique
   * set and find a commit that has _all_ its parents in the targetSet. Then
   * decide to make that commit first, expand targetSet, and then rinse & repeat
   */
  const inOrder = [];
  const allParentsMade = function (node) {
    let allParents = true;
    for (const parent of node.parents) {
      allParents = allParents && targetSet[parent];
    }
    return allParents;
  };

  while (differenceUnique.length > 0) {
    for (let index = 0; index < differenceUnique.length; index++) {
      if (!allParentsMade(differenceUnique[index])) {
        // This commit cannot be made since not all of its dependencies are
        // satisfied.
        continue;
      }

      const makeThis = differenceUnique[index];
      inOrder.push(makeThis);
      // remove the commit
      differenceUnique.splice(index, 1);
      // expand target set
      targetSet[makeThis.id] = true;
    }
  }
  return inOrder;
};

GitEngine.prototype.push = function (options) {
  options = options || {};

  if (options.source === '') {
    // delete case
    this.pushDeleteRemoteBranch(
      this.refs[ORIGIN_PREFIX + options.destination],
      this.origin.refs[options.destination],
    );
    return;
  }

  const sourceBranch = this.resolveID(options.source);
  if (sourceBranch && sourceBranch.attributes.type === 'tag') {
    throw new GitError({
      msg: intl.todo('Tags are not allowed as sources for pushing'),
    });
  }

  if (!this.origin.doesRefExist(options.destination)) {
    console.warn('ref', options.destination);
    this.makeBranchOnOriginAndTrack(
      options.destination,
      this.getCommitFromRef(sourceBranch),
    );
    // play an animation now since we might not have to fast forward
    // anything... this is weird because we are punting an animation
    // and not resolving the promise but whatever
    this.animationFactory.playRefreshAnimation(this.origin.gitVisuals);
    this.animationFactory.playRefreshAnimation(this.gitVisuals);
  }
  const branchOnRemote = this.origin.resolveID(options.destination);
  const sourceLocation = this.resolveID(options.source || 'HEAD');

  // first check if this is even allowed by checking the sync between
  if (!options.force) {
    this.checkUpstreamOfSource(
      this,
      this.origin,
      branchOnRemote,
      sourceLocation,
      intl.str('git-error-origin-push-no-ff'),
    );
  }

  let commitsToMake = this.getTargetGraphDifference(
    this.origin,
    this,
    branchOnRemote,
    sourceLocation,
    /* options */ {
      dontThrowOnNoFetch: true,
    },
  );
  if (commitsToMake.length === 0) {
    if (!options.force) {
      // We are already up to date, and we can't be deleting
      // either since we don't have --force
      throw new GitError({
        msg: intl.str('git-error-origin-fetch-uptodate'),
      });
    } else {
      const sourceCommit = this.getCommitFromRef(sourceBranch);
      const originCommit = this.getCommitFromRef(branchOnRemote);
      if (sourceCommit.id === originCommit.id) {
        // This is essentially also being up to date
        throw new GitError({
          msg: intl.str('git-error-origin-fetch-uptodate'),
        });
      }
      // Otherwise fall through! We will update origin
      // and essentially delete the commit
    }
  }

  // now here is the tricky part -- the difference between local master
  // and remote master might be commits C2, C3, and C4, but the remote
  // might already have those commits. In this case, we don't need to
  // make them, so filter these out
  commitsToMake = commitsToMake.filter(function (commitJSON) {
    return !this.origin.refs[commitJSON.id];
  }, this);

  const makeCommit = function (id, parentIDs) {
    // need to get the parents first. since we order by depth, we know
    // the dependencies are there already
    const parents = parentIDs.map(function (parentID) {
      return this.origin.refs[parentID];
    }, this);
    return this.origin.makeCommit(parents, id);
  }.bind(this);

  // now make the promise chain to make each commit
  const chainStep = function (id, parents) {
    const newCommit = makeCommit(id, parents);
    return this.animationFactory.playCommitBirthPromiseAnimation(
      newCommit,
      this.origin.gitVisuals,
    );
  }.bind(this);

  const deferred = Q.defer();
  let chain = deferred.promise;

  commitsToMake.forEach(function (commitJSON) {
    chain = chain.then(() => this.animationFactory.playHighlightPromiseAnimation(
      this.refs[commitJSON.id],
      branchOnRemote,
    ));

    chain = chain.then(() => chainStep(
      commitJSON.id,
      commitJSON.parents,
    ));
  }, this);

  chain = chain.then(() => {
    const localLocationID = this.getCommitFromRef(sourceLocation).get('id');
    const remoteCommit = this.origin.refs[localLocationID];
    this.origin.setTargetLocation(branchOnRemote, remoteCommit);
    // unhighlight local
    this.animationFactory.playRefreshAnimation(this.gitVisuals);
    return this.animationFactory.playRefreshAnimation(this.origin.gitVisuals);
  });

  // HAX HAX update master and remote tracking for master
  chain = chain.then(() => {
    const localCommit = this.getCommitFromRef(sourceLocation);
    this.setTargetLocation(this.resolveID(ORIGIN_PREFIX + options.destination), localCommit);
    return this.animationFactory.playRefreshAnimation(this.gitVisuals);
  });

  if (!options.dontResolvePromise) {
    this.animationQueue.thenFinish(chain, deferred);
  }
};

GitEngine.prototype.pushDeleteRemoteBranch = function (
  remoteBranch,
  branchOnRemote,
) {
  if (branchOnRemote.get('id') === 'master') {
    throw new GitError({
      msg: intl.todo('You cannot delete master branch on remote!'),
    });
  }
  // ok so this isn't too bad -- we basically just:
  // 1) instruct the remote to delete the branch
  // 2) kill off the remote branch locally
  // 3) find any branches tracking this remote branch and set them to not track
  const id = remoteBranch.get('id');
  this.origin.deleteBranch(branchOnRemote);
  this.deleteBranch(remoteBranch);
  this.branchCollection.each((branch) => {
    if (branch.getRemoteTrackingBranchID() === id) {
      branch.setRemoteTrackingBranchID(null);
    }
  }, this);

  // animation needs to be triggered on origin directly
  this.origin.pruneTree();
  this.origin.externalRefresh();
};

GitEngine.prototype.fetch = function (options) {
  options = options || {};
  let didMakeBranch;

  // first check for super stupid case where we are just making
  // a branch with fetch...
  if (options.destination && options.source === '') {
    this.validateAndMakeBranch(
      options.destination,
      this.getCommitFromRef('HEAD'),
    );
    return;
  } if (options.destination && options.source) {
    didMakeBranch = didMakeBranch || this.makeRemoteBranchIfNeeded(options.source);
    didMakeBranch = didMakeBranch || this.makeBranchIfNeeded(options.destination);
    options.didMakeBranch = didMakeBranch;

    return this.fetchCore([{
      destination: options.destination,
      source: options.source,
    }],
    options);
  }
  // get all remote branches and specify the dest / source pairs
  const allBranchesOnRemote = this.origin.branchCollection.toArray();
  const sourceDestinationPairs = allBranchesOnRemote.map(function (branch) {
    const branchName = branch.get('id');
    didMakeBranch = didMakeBranch || this.makeRemoteBranchIfNeeded(branchName);

    return {
      destination: branch.getPrefixedID(),
      source: branchName,
    };
  }, this);
  options.didMakeBranch = didMakeBranch;
  return this.fetchCore(sourceDestinationPairs, options);
};

GitEngine.prototype.fetchCore = function (sourceDestinationPairs, options) {
  // first check if our local remote branch is upstream of the origin branch set.
  // this check essentially pretends the local remote branch is in origin and
  // could be fast forwarded (basic sanity check)
  sourceDestinationPairs.forEach(function (pair) {
    this.checkUpstreamOfSource(
      this,
      this.origin,
      pair.destination,
      pair.source,
    );
  }, this);

  // then we get the difference in commits between these two graphs
  let commitsToMake = [];
  sourceDestinationPairs.forEach(function (pair) {
    commitsToMake = commitsToMake.concat(this.getTargetGraphDifference(
      this,
      this.origin,
      pair.destination,
      pair.source,
      {

        ...options,
        dontThrowOnNoFetch: true,
      },
    ));
  }, this);

  if (commitsToMake.length === 0 && !options.dontThrowOnNoFetch) {
    throw new GitError({
      msg: intl.str('git-error-origin-fetch-uptodate'),
    });
  }

  // we did this for each remote branch, but we still need to reduce to unique
  // and sort. in this particular app we can never have unfected remote
  // commits that are upstream of multiple branches (since the fakeTeamwork
  // command simply commits), but we are doing it anyways for correctness
  commitsToMake = Graph.getUniqueObjects(commitsToMake);
  commitsToMake = Graph.descendSortDepth(commitsToMake);

  // now here is the tricky part -- the difference between local master
  // and remote master might be commits C2, C3, and C4, but we
  // might already have those commits. In this case, we don't need to
  // make them, so filter these out
  commitsToMake = commitsToMake.filter(function (commitJSON) {
    return !this.refs[commitJSON.id];
  }, this);

  const makeCommit = function (id, parentIDs) {
    // need to get the parents first. since we order by depth, we know
    // the dependencies are there already
    const parents = parentIDs.map(function (parentID) {
      return this.resolveID(parentID);
    }, this);
    return this.makeCommit(parents, id);
  }.bind(this);

  // now make the promise chain to make each commit
  const chainStep = function (id, parents) {
    const newCommit = makeCommit(id, parents);
    return this.animationFactory.playCommitBirthPromiseAnimation(
      newCommit,
      this.gitVisuals,
    );
  }.bind(this);

  const deferred = Q.defer();
  let chain = deferred.promise;
  if (options.didMakeBranch) {
    chain = chain.then(() => {
      this.animationFactory.playRefreshAnimation(this.origin.gitVisuals);
      return this.animationFactory.playRefreshAnimation(this.gitVisuals);
    });
  }

  const originBranchSet = this.origin.getUpstreamBranchSet();
  commitsToMake.forEach(function (commitJSON) {
    // technically we could grab the wrong one here
    // but this works for now
    const originBranch = originBranchSet[commitJSON.id][0].obj;
    const localBranch = this.refs[originBranch.getPrefixedID()];

    chain = chain.then(() => this.animationFactory.playHighlightPromiseAnimation(
      this.origin.resolveID(commitJSON.id),
      localBranch,
    ));

    chain = chain.then(() => chainStep(
      commitJSON.id,
      commitJSON.parents,
    ));
  }, this);

  chain = chain.then(() => {
    // update all the destinations
    sourceDestinationPairs.forEach(function (pair) {
      const ours = this.resolveID(pair.destination);
      const theirCommitID = this.origin.getCommitFromRef(pair.source).get('id');
      // by definition we just made the commit with this id,
      // so we can grab it now
      const localCommit = this.refs[theirCommitID];
      this.setTargetLocation(ours, localCommit);
    }, this);

    // unhighlight origin by refreshing
    this.animationFactory.playRefreshAnimation(this.origin.gitVisuals);
    return this.animationFactory.playRefreshAnimation(this.gitVisuals);
  });

  if (!options.dontResolvePromise) {
    this.animationQueue.thenFinish(chain, deferred);
  }
  return {
    chain,
    deferred,
  };
};

GitEngine.prototype.pull = function (options) {
  options = options || {};
  const localBranch = this.getOneBeforeCommit('HEAD');

  // no matter what fetch
  const pendingFetch = this.fetch({
    dontResolvePromise: true,
    dontThrowOnNoFetch: true,
    source: options.source,
    destination: options.destination,
  });

  if (!pendingFetch) {
    // short circuited for some reason
    return;
  }

  const destinationBranch = this.resolveID(options.destination);
  // then either rebase or merge
  if (options.isRebase) {
    this.pullFinishWithRebase(pendingFetch, localBranch, destinationBranch);
  } else {
    this.pullFinishWithMerge(pendingFetch, localBranch, destinationBranch);
  }
};

GitEngine.prototype.pullFinishWithRebase = function (
  pendingFetch,
  localBranch,
  remoteBranch,
) {
  let { chain } = pendingFetch;
  const { deferred } = pendingFetch;
  chain = chain.then(() => {
    if (this.isUpstreamOf(remoteBranch, localBranch)) {
      this.command.set('error', new CommandResult({
        msg: intl.str('git-result-uptodate'),
      }));
      throw SHORT_CIRCUIT_CHAIN;
    }
  });

  // delay a bit after the intense refresh animation from
  // fetch
  chain = chain.then(() => this.animationFactory.getDelayedPromise(300));

  chain = chain.then(() =>
    // highlight last commit on o/master to color of
    // local branch
    this.animationFactory.playHighlightPromiseAnimation(
      this.getCommitFromRef(remoteBranch),
      localBranch,
    ));

  chain = chain.then(() => {
    pendingFetch.dontResolvePromise = true;

    // Lets move the git pull --rebase check up here.
    if (this.isUpstreamOf(localBranch, remoteBranch)) {
      this.setTargetLocation(
        localBranch,
        this.getCommitFromRef(remoteBranch),
      );
      this.checkout(localBranch);
      return this.animationFactory.playRefreshAnimation(this.gitVisuals);
    }

    try {
      return this.rebase(remoteBranch, localBranch, pendingFetch);
    } catch (error) {
      this.filterError(error);
      if (error.getMsg() !== intl.str('git-error-rebase-none')) {
        throw error;
      }
      this.setTargetLocation(
        localBranch,
        this.getCommitFromRef(remoteBranch),
      );
      this.checkout(localBranch);
      return this.animationFactory.playRefreshAnimation(this.gitVisuals);
    }
  });
  chain = chain.fail(catchShortCircuit);

  this.animationQueue.thenFinish(chain, deferred);
};

GitEngine.prototype.pullFinishWithMerge = function (
  pendingFetch,
  localBranch,
  remoteBranch,
) {
  let { chain } = pendingFetch;
  const { deferred } = pendingFetch;

  chain = chain.then(() => {
    if (this.mergeCheck(remoteBranch, localBranch)) {
      this.command.set('error', new CommandResult({
        msg: intl.str('git-result-uptodate'),
      }));
      throw SHORT_CIRCUIT_CHAIN;
    }
  });

  // delay a bit after the intense refresh animation from
  // fetch
  chain = chain.then(() => this.animationFactory.getDelayedPromise(300));

  chain = chain.then(() =>
    // highlight last commit on o/master to color of
    // local branch
    this.animationFactory.playHighlightPromiseAnimation(
      this.getCommitFromRef(remoteBranch),
      localBranch,
    ));

  chain = chain.then(() =>
    // highlight commit on master to color of remote
    this.animationFactory.playHighlightPromiseAnimation(
      this.getCommitFromRef(localBranch),
      remoteBranch,
    ));

  // delay and merge
  chain = chain.then(() => this.animationFactory.getDelayedPromise(700));
  chain = chain.then(() => {
    const newCommit = this.merge(remoteBranch);
    if (!newCommit) {
      // it is a fast forward
      return this.animationFactory.playRefreshAnimation(this.gitVisuals);
    }

    return this.animationFactory.playCommitBirthPromiseAnimation(
      newCommit,
      this.gitVisuals,
    );
  });
  chain = chain.fail(catchShortCircuit);

  this.animationQueue.thenFinish(chain, deferred);
};

GitEngine.prototype.fakeTeamwork = function (numberToMake, branch) {
  const makeOriginCommit = function () {
    const id = this.getUniqueID();
    return this.origin.receiveTeamwork(id, branch, this.animationQueue);
  }.bind(this);

  const chainStep = function () {
    const newCommit = makeOriginCommit();
    return this.animationFactory.playCommitBirthPromiseAnimation(
      newCommit,
      this.origin.gitVisuals,
    );
  }.bind(this);

  const deferred = Q.defer();
  let chain = deferred.promise;

  for (let index = 0; index < numberToMake; index++) {
    chain = chain.then(chainStep);
  }
  this.animationQueue.thenFinish(chain, deferred);
};

GitEngine.prototype.receiveTeamwork = function (id, branch, animationQueue) {
  this.checkout(this.resolveID(branch));
  const newCommit = this.makeCommit([this.getCommitFromRef('HEAD')], id);
  this.setTargetLocation(this.HEAD, newCommit);

  return newCommit;
};

GitEngine.prototype.cherrypick = function (commit) {
  // alter the ID slightly
  const id = this.rebaseAltID(commit.get('id'));

  // now commit with that id onto HEAD
  const newCommit = this.makeCommit([this.getCommitFromRef('HEAD')], id);
  this.setTargetLocation(this.HEAD, newCommit);

  return newCommit;
};

GitEngine.prototype.commit = function (options) {
  options = options || {};
  let targetCommit = this.getCommitFromRef(this.HEAD);
  let id = null;

  // if we want to amend, go one above
  if (options.isAmend) {
    targetCommit = this.resolveID('HEAD~1');
    id = this.rebaseAltID(this.getCommitFromRef('HEAD').get('id'));
  }

  const newCommit = this.makeCommit([targetCommit], id);
  if (this.getDetachedHead() && this.mode === 'git') {
    this.command.addWarning(intl.str('git-warning-detached'));
  }

  this.setTargetLocation(this.HEAD, newCommit);
  return newCommit;
};

GitEngine.prototype.resolveName = function (someReference) {
  // first get the obj
  const object = this.resolveID(someReference);
  if (object.get('type') == 'commit') {
    return `commit ${object.get('id')}`;
  }
  if (object.get('type') == 'branch') {
    return `branch "${object.get('id').replace(/\bmaster\b/, 'main')}"`;
  }
  // we are dealing with HEAD
  return this.resolveName(object.get('target'));
};

GitEngine.prototype.resolveID = function (idOrTarget) {
  if (idOrTarget === null || idOrTarget === undefined) {
    const error = new Error();
    throw new Error(`Don't call this with null / undefined: ${error.stack}`);
  }

  if (typeof idOrTarget !== 'string') {
    return idOrTarget;
  }
  return this.resolveStringRef(idOrTarget);
};

GitEngine.prototype.resolveRelativeRef = function (commit, relative) {
  const regex = /([^~])(\d*)/g;
  let matches;

  while (matches = regex.exec(relative)) {
    let next = commit;
    let number = matches[2] ? Number.parseInt(matches[2], 10) : 1;

    if (matches[1] == '^') {
      next = commit.getParent(number - 1);
    } else {
      while (next && number--) {
        next = next.getParent(0);
      }
    }

    if (!next) {
      const message = intl.str('git-error-relative-ref', {
        commit: commit.id,
        match: matches[0],
      });
      throw new GitError({
        msg: message,
      });
    }

    commit = next;
  }

  return commit;
};

GitEngine.prototype.doesRefExist = function (reference) {
  if (/\bmain\b/.test(reference)) {
    reference = reference.replace(/\bmain\b/, 'master');
  }
  return !!this.refs[reference];
};

GitEngine.prototype.resolveStringRef = function (reference) {
  reference = this.crappyUnescape(reference);

  if (/\bmain\b/.test(reference)) {
    reference = reference.replace(/\bmain\b/, 'master');
  }

  if (this.refs[reference]) {
    return this.refs[reference];
  }
  // Commit hashes like C4 are case insensitive
  if (/^c\d+'*/.test(reference) && this.refs[reference.toUpperCase()]) {
    return this.refs[reference.toUpperCase()];
  }

  // Attempt to split ref string into a reference and a string of ~ and ^ modifiers.
  let startReference = null;
  let relative = null;
  const regex = /^([\dA-Za-z]+)(([^~]\d*)*)$/;
  const matches = regex.exec(reference);
  if (matches) {
    startReference = matches[1];
    relative = matches[2];
  } else {
    throw new GitError({
      msg: intl.str('git-error-exist', { ref: reference }),
    });
  }

  if (!this.refs[startReference]) {
    throw new GitError({
      msg: intl.str('git-error-exist', { ref: reference }),
    });
  }
  let commit = this.getCommitFromRef(startReference);

  if (relative) {
    commit = this.resolveRelativeRef(commit, relative);
  }

  return commit;
};

GitEngine.prototype.getCommitFromRef = function (reference) {
  let start = this.resolveID(reference);

  // works for both HEAD and just a single layer. aka branch
  while (start.get('type') !== 'commit') {
    start = start.get('target');
  }
  return start;
};

GitEngine.prototype.getType = function (reference) {
  return this.resolveID(reference).get('type');
};

GitEngine.prototype.setTargetLocation = function (reference, target) {
  if (this.getType(reference) == 'commit') {
    // nothing to do
    return;
  }

  // sets whatever ref is (branch, HEAD, etc) to a target. so if
  // you pass in HEAD, and HEAD is pointing to a branch, it will update
  // the branch to that commit, not the HEAD
  reference = this.getOneBeforeCommit(reference);
  reference.set('target', target);
};

GitEngine.prototype.updateBranchesFromSet = function (commitSet) {
  if (!commitSet) {
    throw new Error('need commit set here');
  }
  // commitSet is the set of commits that are stale or moved or whatever.
  // any branches POINTING to these commits need to be moved!

  // first get a list of what branches influence what commits
  const upstreamSet = this.getUpstreamBranchSet();

  const branchesToUpdate = {};
  // now loop over the set we got passed in and find which branches
  // that means (aka intersection)
  commitSet.forEach((value, id) => {
    for (const branchJSON of upstreamSet[id]) {
      branchesToUpdate[branchJSON.id] = true;
    }
  }, this);

  const branchList = branchesToUpdate.map((value, id) => id);
  return this.updateBranchesForHg(branchList);
};

GitEngine.prototype.updateAllBranchesForHgAndPlay = function (branchList) {
  return this.updateBranchesForHg(branchList)
    && this.animationFactory.playRefreshAnimationSlow(this.gitVisuals);
};

GitEngine.prototype.updateAllBranchesForHg = function () {
  const branchList = this.branchCollection.map((branch) => branch.get('id'));
  return this.updateBranchesForHg(branchList);
};

GitEngine.prototype.syncRemoteBranchFills = function () {
  this.branchCollection.each(function (branch) {
    if (!branch.getIsRemote()) {
      return;
    }
    const originBranch = this.origin.refs[branch.getBaseID()];
    if (!originBranch.get('visBranch')) {
      // testing mode doesn't get this
      return;
    }
    const originFill = originBranch.get('visBranch').get('fill');
    branch.get('visBranch').set('fill', originFill);
  }, this);
};

GitEngine.prototype.updateBranchesForHg = function (branchList) {
  let hasUpdated = false;
  branchList.forEach(function (branchID) {
    // ok now just check if this branch has a more recent commit available.
    // that mapping is easy because we always do rebase alt id --
    // theres no way to have C3' and C3''' but no C3''. so just
    // bump the ID once -- if thats not filled in we are updated,
    // otherwise loop until you find undefined
    const commitID = this.getCommitFromRef(branchID).get('id');
    let altID = this.getBumpedID(commitID);
    if (!this.refs[altID]) {
      return;
    }
    hasUpdated = true;

    let lastID;
    while (this.refs[altID]) {
      lastID = altID;
      altID = this.rebaseAltID(altID);
    }

    // last ID is the one we want to update to
    this.setTargetLocation(this.refs[branchID], this.refs[lastID]);
  }, this);

  if (!hasUpdated) {
    return false;
  }
  return true;
};

GitEngine.prototype.updateCommitParentsForHgRebase = function (commitSet) {
  let anyChange = false;
  Object.keys(commitSet).forEach(function (commitID) {
    const commit = this.refs[commitID];
    const thisUpdated = commit.checkForUpdatedParent(this);
    anyChange = anyChange || thisUpdated;
  }, this);
  return anyChange;
};

GitEngine.prototype.pruneTreeAndPlay = function () {
  return this.pruneTree()
    && this.animationFactory.playRefreshAnimationSlow(this.gitVisuals);
};

GitEngine.prototype.pruneTree = function () {
  const set = this.getUpstreamBranchSet();
  // don't prune commits that HEAD depends on
  const headSet = Graph.getUpstreamSet(this, 'HEAD');
  for (const commitID of Object.keys(headSet)) {
    set[commitID] = true;
  }

  const toDelete = [];
  this.commitCollection.each((commit) => {
    // nothing cares about this commit :(
    if (!set[commit.get('id')]) {
      toDelete.push(commit);
    }
  }, this);

  if (toDelete.length === 0) {
    // returning nothing will perform
    // the switch sync
    return;
  }
  if (this.command) {
    this.command.addWarning(intl.str('hg-prune-tree'));
  }

  toDelete.forEach(function (commit) {
    commit.removeFromParents();
    this.commitCollection.remove(commit);

    const ID = commit.get('id');
    this.refs[ID] = undefined;
    delete this.refs[ID];

    const visNode = commit.get('visNode');
    if (visNode) {
      visNode.removeAll();
    }
  }, this);

  return true;
};

GitEngine.prototype.getUpstreamBranchSet = function () {
  return this.getUpstreamCollectionSet(this.branchCollection);
};

GitEngine.prototype.getUpstreamTagSet = function () {
  return this.getUpstreamCollectionSet(this.tagCollection);
};

GitEngine.prototype.getUpstreamCollectionSet = function (collection) {
  // this is expensive!! so only call once in a while
  const commitToSet = {};

  const inArray = function (array, id) {
    let found = false;
    for (const wrapper of array) {
      if (wrapper.id == id) {
        found = true;
      }
    }

    return found;
  };

  const bfsSearch = function (commit) {
    const set = [];
    let pQueue = [commit];
    while (pQueue.length > 0) {
      const popped = pQueue.pop();
      set.push(popped.get('id'));

      if (popped.get('parents') && popped.get('parents').length > 0) {
        pQueue = pQueue.concat(popped.get('parents'));
      }
    }
    return set;
  };

  collection.each((reference) => {
    const set = bfsSearch(reference.get('target'));
    for (const id of set) {
      commitToSet[id] = commitToSet[id] || [];

      // only add it if it's not there, so hue blending is ok
      if (!inArray(commitToSet[id], reference.get('id'))) {
        commitToSet[id].push({
          obj: reference,
          id: reference.get('id'),
        });
      }
    }
  });

  return commitToSet;
};

GitEngine.prototype.getUpstreamHeadSet = function () {
  const set = Graph.getUpstreamSet(this, 'HEAD');
  const including = this.getCommitFromRef('HEAD').get('id');

  set[including] = true;
  return set;
};

GitEngine.prototype.getOneBeforeCommit = function (reference) {
  // you can call this command on HEAD in detached, HEAD, or on a branch
  // and it will return the ref that is one above a commit. aka
  // it resolves HEAD to something that we can move the ref with
  let start = this.resolveID(reference);
  if (start === this.HEAD && !this.getDetachedHead()) {
    start = start.get('target');
  }
  return start;
};

GitEngine.prototype.scrapeBaseID = function (id) {
  const results = /^C(\d+)/.exec(id);

  if (!results) {
    throw new Error(`regex failed on ${id}`);
  }

  return `C${results[1]}`;
};

/*
 * grabs a bumped ID that is NOT currently reserved
 */
GitEngine.prototype.rebaseAltID = function (id) {
  let newID = this.getBumpedID(id);
  while (this.refs[newID]) {
    newID = this.getBumpedID(newID);
  }
  return newID;
};

GitEngine.prototype.getMostRecentBumpedID = function (id) {
  let newID = id;
  let lastID;
  while (this.refs[newID]) {
    lastID = newID;
    newID = this.getBumpedID(newID);
  }
  return lastID;
};

GitEngine.prototype.getBumpedID = function (id) {
  // this function alters an ID to add a quote to the end,
  // indicating that it was rebased.
  const regexMap = [
    [/^C(\d+)'{0,2}$/, function (bits) {
      // this id can use another quote, so just add it
      return `${bits[0]}'`;
    }],
    [/^C(\d+)'{3}$/, function (bits) {
      // here we switch from C''' to C'^4
      return `${bits[0].slice(0, -3)}'^4`;
    }],
    [/^C(\d+)'\^(\d+)$/, function (bits) {
      return `C${String(bits[1])}'^${String(Number(bits[2]) + 1)}`;
    }],
  ];

  // for loop for early return (instead of _.each)
  for (const element of regexMap) {
    const regex = element[0];
    const function_ = element[1];
    const results = regex.exec(id);
    if (results) {
      return function_(results);
    }
  }
  throw new Error(`could not modify the id ${id}`);
};

GitEngine.prototype.idSortFunc = function (cA, cB) {
  // commit IDs can come in many forms:
  //  C4
  //  C4' (from a rebase)
  //  C4'' (from multiple rebases)
  //  C4'^3 (from a BUNCH of rebases)

  const scale = 1000;

  const regexMap = [
    [/^C(\d+)$/, function (bits) {
      // return the 4 from C4
      return scale * bits[1];
    }],
    [/^C(\d+)('+)$/, function (bits) {
      // return the 4 from C4, plus the length of the quotes
      return scale * bits[1] + bits[2].length;
    }],
    [/^C(\d+)'\^(\d+)$/, function (bits) {
      return scale * bits[1] + Number(bits[2]);
    }],
  ];

  const getNumberToSort = function (id) {
    for (const element of regexMap) {
      const regex = element[0];
      const function_ = element[1];
      const results = regex.exec(id);
      if (results) {
        return function_(results);
      }
    }
    throw new Error(`Could not parse commit ID ${id}`);
  };

  // We usually want to sort by reverse chronological order, aka the
  // "latest" commits have the highest values. When we did this
  // with date sorting, that means the commit C1 at t=0 should have
  // a lower value than the commit C2 at t=1. We do this by doing
  // t0 - t1 and get a negative number. Same goes for ID sorting,
  // which means C1 - C2 = -1
  return getNumberToSort(cA.get('id')) - getNumberToSort(cB.get('id'));
};

GitEngine.prototype.dateSortFunc = function (cA, cB) {
  // We used to use date sorting, but its hacky so lets switch to ID sorting
  // to eliminate non-determinism
  return GitEngine.prototype.idSortFunc(cA, cB);
};

GitEngine.prototype.hgRebase = function (destination, base) {
  const deferred = Q.defer();
  let chain = this.rebase(destination, base, {
    dontResolvePromise: true,
    deferred,
  });

  // was upstream or something
  if (!chain) {
    return;
  }

  // ok lets grab the merge base first
  const commonAncestor = this.getCommonAncestor(destination, base);
  const baseCommit = this.getCommitFromRef(base);
  // we need everything BELOW ourselves...
  const downstream = this.getDownstreamSet(base);
  // and we need to go upwards to the stop set
  const stopSet = Graph.getUpstreamSet(this, destination);
  const upstream = this.getUpstreamDiffSetFromSet(stopSet, base);

  // and NOWWWwwww get all the descendants of this set
  const moreSets = [];
  Object.keys(upstream).forEach(function (id) {
    moreSets.push(this.getDownstreamSet(id));
  }, this);

  const masterSet = {};
  masterSet[baseCommit.get('id')] = true;
  for (const set of [upstream, downstream, ...moreSets]) {
    for (const id of Object.keys(set)) {
      masterSet[id] = true;
    }
  }

  // we also need the branches POINTING to master set
  const branchMap = {};
  const upstreamSet = this.getUpstreamBranchSet();
  for (const commitID of Object.keys(masterSet)) {
    // now loop over that commits branches
    for (const branchJSON of upstreamSet[commitID]) {
      branchMap[branchJSON.id] = true;
    }
  }

  const branchList = Object.keys(branchMap);

  chain = chain.then(() => {
    // now we just moved a bunch of commits, but we haven't updated the
    // dangling guys. lets do that and then prune
    const anyChange = this.updateCommitParentsForHgRebase(masterSet);
    if (!anyChange) {
      return;
    }
    return this.animationFactory.playRefreshAnimationSlow(this.gitVisuals);
  });

  chain = chain.then(() => this.updateAllBranchesForHgAndPlay(branchList));

  chain = chain.then(() =>
    // now that we have moved branches, lets prune
    this.pruneTreeAndPlay());

  this.animationQueue.thenFinish(chain, deferred);
};

GitEngine.prototype.rebase = function (targetSource, currentLocation, options) {
  // first some conditions
  if (this.isUpstreamOf(targetSource, currentLocation)) {
    this.command.setResult(intl.str('git-result-uptodate'));

    // git for some reason always checks out the branch you are rebasing,
    // no matter the result of the rebase
    this.checkout(currentLocation);

    // returning instead of throwing makes a tree refresh
    return;
  }

  if (this.isUpstreamOf(currentLocation, targetSource)) {
    // just set the target of this current location to the source
    this.setTargetLocation(currentLocation, this.getCommitFromRef(targetSource));
    // we need the refresh tree animation to happen, so set the result directly
    // instead of throwing
    this.command.setResult(intl.str('git-result-fastforward'));

    this.checkout(currentLocation);
    return;
  }

  // now the part of actually rebasing.
  // We need to get the downstream set of targetSource first.
  // then we BFS from currentLocation, using the downstream set as our stopping point.
  // we need to BFS because we need to include all commits below
  // pop these commits on top of targetSource and modify their ids with quotes
  const stopSet = Graph.getUpstreamSet(this, targetSource);
  const toRebaseRough = this.getUpstreamDiffFromSet(stopSet, currentLocation);
  return this.rebaseFinish(toRebaseRough, stopSet, targetSource, currentLocation, options);
};

GitEngine.prototype.getUpstreamDiffSetFromSet = function (stopSet, location) {
  const set = {};
  for (const commit of this.getUpstreamDiffFromSet(stopSet, location)) {
    set[commit.get('id')] = true;
  }
  return set;
};

GitEngine.prototype.getUpstreamDiffFromSet = function (stopSet, location) {
  const result = Graph.bfsFromLocationWithSet(this, location, stopSet);
  result.sort(this.dateSortFunc);
  return result;
};

GitEngine.prototype.getInteractiveRebaseCommits = function (targetSource, currentLocation) {
  const stopSet = Graph.getUpstreamSet(this, targetSource);
  const toRebaseRough = [];

  // standard BFS
  let pQueue = [this.getCommitFromRef(currentLocation)];

  while (pQueue.length > 0) {
    const popped = pQueue.pop();

    if (stopSet[popped.get('id')]) {
      continue;
    }

    toRebaseRough.push(popped);
    pQueue = pQueue.concat(popped.get('parents'));
    pQueue.sort(this.dateSortFunc);
  }

  // throw out merge's real fast and see if we have anything to do
  const toRebase = [];
  for (const commit of toRebaseRough) {
    if (commit.get('parents').length == 1) {
      toRebase.push(commit);
    }
  }

  if (toRebase.length === 0) {
    throw new GitError({
      msg: intl.str('git-error-rebase-none'),
    });
  }

  return toRebase;
};

GitEngine.prototype.rebaseInteractiveTest = function (targetSource, currentLocation, options) {
  options = options || {};

  // Get the list of commits that would be displayed to the user
  const toRebase = this.getInteractiveRebaseCommits(targetSource, currentLocation);

  const rebaseMap = {};
  for (const commit of toRebase) {
    const id = commit.get('id');
    rebaseMap[id] = commit;
  }

  let rebaseOrder;
  if (options.interactiveTest.length === 0) {
    // If no commits were explicitly specified for the rebase, act like the user didn't change anything
    // in the rebase dialog and hit confirm
    rebaseOrder = toRebase;
  } else {
    // Get the list and order of commits specified
    const idsToRebase = options.interactiveTest[0].split(',');

    // Verify each chosen commit exists in the list of commits given to the user
    const extraCommits = [];
    rebaseOrder = [];
    for (const id of idsToRebase) {
      if (id in rebaseMap) {
        rebaseOrder.push(rebaseMap[id]);
      } else {
        extraCommits.push(id);
      }
    }

    if (extraCommits.length > 0) {
      throw new GitError({
        msg: intl.todo("Hey those commits don't exist in the set!"),
      });
    }
  }

  this.rebaseFinish(rebaseOrder, {}, targetSource, currentLocation);
};

GitEngine.prototype.rebaseInteractive = function (targetSource, currentLocation, options) {
  options = options || {};

  // there are a reduced set of checks now, so we can't exactly use parts of the rebase function
  // but it will look similar.
  const toRebase = this.getInteractiveRebaseCommits(targetSource, currentLocation);

  // now do stuff :D since all our validation checks have passed, we are going to defer animation
  // and actually launch the dialog
  this.animationQueue.set('defer', true);

  const deferred = Q.defer();
  deferred.promise
    .then((userSpecifiedRebase) => {
    // first, they might have dropped everything (annoying)
      if (userSpecifiedRebase.length === 0) {
        throw new CommandResult({
          msg: intl.str('git-result-nothing'),
        });
      }

      // finish the rebase crap and animate!
      this.rebaseFinish(userSpecifiedRebase, {}, targetSource, currentLocation);
    })
    .fail((error) => {
      this.filterError(error);
      this.command.set('error', error);
      this.animationQueue.start();
    })
    .done();

  // If we have a solution provided, set up the GUI to display it by default
  let initialCommitOrdering;
  if (options.initialCommitOrdering && options.initialCommitOrdering.length > 0) {
    const rebaseMap = {};
    for (const commit of toRebase) {
      rebaseMap[commit.get('id')] = true;
    }

    // Verify each chosen commit exists in the list of commits given to the user
    initialCommitOrdering = [];
    for (const id of options.initialCommitOrdering[0].split(',')) {
      if (!rebaseMap[id]) {
        throw new GitError({
          msg: intl.todo("Hey those commits don't exist in the set!"),
        });
      }
      initialCommitOrdering.push(id);
    }
  }

  const { InteractiveRebaseView } = require('../views/rebaseView');
  // interactive rebase view will reject or resolve our promise
  new InteractiveRebaseView({
    deferred,
    toRebase,
    initialCommitOrdering,
    aboveAll: options.aboveAll,
  });
};

GitEngine.prototype.filterRebaseCommits = function (
  toRebaseRough,
  stopSet,
  options,
) {
  const changesAlreadyMade = {};
  Object.keys(stopSet).forEach(function (key) {
    changesAlreadyMade[this.scrapeBaseID(key)] = true;
  }, this);
  const uniqueIDs = {};

  // resolve the commits we will rebase
  return toRebaseRough.filter(function (commit) {
    // no merge commits, unless we preserve
    if (commit.get('parents').length !== 1 && !options.preserveMerges) {
      return false;
    }

    // we ALSO need to throw out commits that will do the same changes. like
    // if the upstream set has a commit C4 and we have C4', we don't rebase the C4' again.
    const baseID = this.scrapeBaseID(commit.get('id'));
    if (changesAlreadyMade[baseID]) {
      return false;
    }

    // make unique
    if (uniqueIDs[commit.get('id')]) {
      return false;
    }

    uniqueIDs[commit.get('id')] = true;
    return true;
  }, this);
};

GitEngine.prototype.getRebasePreserveMergesParents = function (oldCommit) {
  const oldParents = oldCommit.get('parents');
  return oldParents.map(function (parent) {
    const oldID = parent.get('id');
    const newID = this.getMostRecentBumpedID(oldID);
    return this.refs[newID];
  }, this);
};

GitEngine.prototype.rebaseFinish = function (
  toRebaseRough,
  stopSet,
  targetSource,
  currentLocation,
  options,
) {
  options = options || {};
  // now we have the all the commits between currentLocation and the set of target to rebase.
  const destinationBranch = this.resolveID(targetSource);
  const deferred = options.deferred || Q.defer();
  let chain = options.chain || deferred.promise;

  const toRebase = this.filterRebaseCommits(toRebaseRough, stopSet, options);
  if (toRebase.length === 0) {
    throw new GitError({
      msg: intl.str('git-error-rebase-none'),
    });
  }

  chain = this.animationFactory.highlightEachWithPromise(
    chain,
    toRebase,
    destinationBranch,
  );

  // now pop all of these commits onto targetLocation
  let base = this.getCommitFromRef(targetSource);
  let hasStartedChain = false;
  // each step makes a new commit
  const chainStep = function (oldCommit) {
    const newId = this.rebaseAltID(oldCommit.get('id'));
    let parents;
    if (!options.preserveMerges || !hasStartedChain) {
      // easy logic since we just have a straight line
      parents = [base];
    } else { // preserving merges
      // we always define the parent for the first commit to plop,
      // otherwise search for most recent parents
      parents = (hasStartedChain)
        ? this.getRebasePreserveMergesParents(oldCommit)
        : [base];
    }

    const newCommit = this.makeCommit(parents, newId);
    base = newCommit;
    hasStartedChain = true;

    return this.animationFactory.playCommitBirthPromiseAnimation(
      newCommit,
      this.gitVisuals,
    );
  }.bind(this);

  // set up the promise chain
  toRebase.forEach((commit) => {
    chain = chain.then(() => chainStep(commit));
  }, this);

  chain = chain.then(() => {
    if (this.resolveID(currentLocation).get('type') == 'commit') {
      // we referenced a commit like git rebase C2 C1, so we have
      // to manually check out C1'
      this.checkout(base);
    } else {
      // now we just need to update the rebased branch is
      this.setTargetLocation(currentLocation, base);
      this.checkout(currentLocation);
    }
    return this.animationFactory.playRefreshAnimation(this.gitVisuals);
  });

  if (!options.dontResolvePromise) {
    this.animationQueue.thenFinish(chain, deferred);
  }
  return chain;
};

GitEngine.prototype.mergeCheck = function (targetSource, currentLocation) {
  const sameCommit = this.getCommitFromRef(targetSource)
    === this.getCommitFromRef(currentLocation);
  return this.isUpstreamOf(targetSource, currentLocation) || sameCommit;
};

GitEngine.prototype.merge = function (targetSource, options) {
  options = options || {};
  const currentLocation = 'HEAD';

  // first some conditions
  if (this.mergeCheck(targetSource, currentLocation)) {
    throw new CommandResult({
      msg: intl.str('git-result-uptodate'),
    });
  }

  if (this.isUpstreamOf(currentLocation, targetSource) && !options.noFF) {
    // just set the target of this current location to the source
    this.setTargetLocation(currentLocation, this.getCommitFromRef(targetSource));
    // get fresh animation to happen
    this.command.setResult(intl.str('git-result-fastforward'));
    return;
  }

  // now the part of making a merge commit
  const parent1 = this.getCommitFromRef(currentLocation);
  const parent2 = this.getCommitFromRef(targetSource);

  // we need a fancy commit message
  const message = intl.str(
    'git-merge-msg',
    {
      target: this.resolveName(targetSource),
      current: this.resolveName(currentLocation),
    },
  );
  // since we specify parent 1 as the first parent, it is the "main" parent
  // and the node will be displayed below that branch / commit / whatever
  const mergeCommit = this.makeCommit(
    [parent1, parent2],
    null,
    {
      commitMessage: message,
    },
  );

  this.setTargetLocation(currentLocation, mergeCommit);
  return mergeCommit;
};

GitEngine.prototype.checkout = function (idOrTarget) {
  let target = this.resolveID(idOrTarget);
  if (target.get('id') === 'HEAD') {
    // git checkout HEAD is a
    // meaningless command but i used to do this back in the day
    return;
  }

  const type = target.get('type');
  // check if this is an origin branch, and if so go to the commit referenced
  if (type === 'branch' && target.getIsRemote()) {
    target = this.getCommitFromRef(target.get('id'));
  }

  if (type !== 'branch' && type !== 'tag' && type !== 'commit') {
    throw new GitError({
      msg: intl.str('git-error-options'),
    });
  }
  if (type === 'tag') {
    target = target.get('target');
  }

  this.HEAD.set('target', target);
};

GitEngine.prototype.forceBranch = function (branchName, where) {
  branchName = this.crappyUnescape(branchName);
  // if branchname doesn't exist...
  if (!this.doesRefExist(branchName)) {
    this.branch(branchName, where);
  }

  const branch = this.resolveID(branchName);

  if (branch.get('type') !== 'branch') {
    throw new GitError({
      msg: intl.str('git-error-options'),
    });
  }
  if (branch.getIsRemote()) {
    throw new GitError({
      msg: intl.str('git-error-remote-branch'),
    });
  }

  const whereCommit = this.getCommitFromRef(where);

  this.setTargetLocation(branch, whereCommit);
};

GitEngine.prototype.branch = function (name, reference) {
  const target = this.getCommitFromRef(reference);
  const newBranch = this.validateAndMakeBranch(name, target);

  reference = this.resolveID(reference);
  if (this.isRemoteBranchRef(reference)) {
    this.setLocalToTrackRemote(newBranch, reference);
  }
};

GitEngine.prototype.isRemoteBranchRef = function (reference) {
  const resolved = this.resolveID(reference);
  if (resolved.get('type') !== 'branch') {
    return false;
  }
  return resolved.getIsRemote();
};

GitEngine.prototype.tag = function (name, reference) {
  const target = this.getCommitFromRef(reference);
  this.validateAndMakeTag(name, target);
};

GitEngine.prototype.describe = function (reference) {
  const startCommit = this.getCommitFromRef(reference);
  // ok we need to BFS from start upwards until we hit a tag. but
  // first we need to get a reverse mapping from tag to commit
  const tagMap = {};
  for (const tag of this.tagCollection.toJSON()) {
    tagMap[tag.target.get('id')] = tag.id;
  }

  let pQueue = [startCommit];
  let foundTag;
  const numberAway = [];
  while (pQueue.length > 0) {
    const popped = pQueue.pop();
    const thisID = popped.get('id');
    if (tagMap[thisID]) {
      foundTag = tagMap[thisID];
      break;
    }
    // ok keep going
    numberAway.push(popped.get('id'));

    const parents = popped.get('parents');
    if (parents && parents.length > 0) {
      pQueue = pQueue.concat(parents);
      pQueue.sort(this.dateSortFunc);
    }
  }

  if (!foundTag) {
    throw new GitError({
      msg: intl.todo('Fatal: no tags found upstream'),
    });
  }

  if (numberAway.length === 0) {
    throw new CommandResult({
      msg: foundTag,
    });
  }

  // then join
  throw new CommandResult({
    msg: `${foundTag}_${numberAway.length}_g${startCommit.get('id')}`,
  });
};

GitEngine.prototype.validateAndDeleteBranch = function (name) {
  // trying to delete, lets check our refs
  const target = this.resolveID(name);

  if (target.get('type') !== 'branch'
      || target.get('id') == 'master'
      || this.HEAD.get('target') === target) {
    throw new GitError({
      msg: intl.str('git-error-branch'),
    });
  }

  // now we know it's a branch
  const branch = target;
  // if its remote
  if (target.getIsRemote()) {
    throw new GitError({
      msg: intl.str('git-error-remote-branch'),
    });
  }
  this.deleteBranch(branch);
};

GitEngine.prototype.deleteBranch = function (branch) {
  this.branchCollection.remove(branch);
  this.refs[branch.get('id')] = undefined;
  delete this.refs[branch.get('id')];
  // also in some cases external engines call our delete, so
  // verify integrity of HEAD here
  if (this.HEAD.get('target') === branch) {
    this.HEAD.set('target', this.refs.master);
  }

  if (branch.get('visBranch')) {
    branch.get('visBranch').remove();
  }
};

GitEngine.prototype.crappyUnescape = function (string) {
  return string.replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
};

GitEngine.prototype.filterError = function (error) {
  if (!(error instanceof GitError
      || error instanceof CommandResult)) {
    throw error;
  }
};

// called on a origin repo from a local -- simply refresh immediately with
// an animation
GitEngine.prototype.externalRefresh = function () {
  this.animationQueue = new AnimationQueue({
    callback() {},
  });
  this.animationFactory.refreshTree(this.animationQueue, this.gitVisuals);
  this.animationQueue.start();
};

GitEngine.prototype.dispatch = function (command, deferred) {
  this.command = command;
  const vcs = command.get('vcs');
  const executeCommand = function () {
    this.dispatchProcess(command, deferred);
  }.bind(this);
  // handle mode change will either execute sync or
  // animate during tree pruning / etc
  this.handleModeChange(vcs, executeCommand);
};

GitEngine.prototype.dispatchProcess = function (command, deferred) {
  // set up the animation queue
  const whenDone = function () {
    command.finishWith(deferred);
  };
  this.animationQueue = new AnimationQueue({
    callback: whenDone,
  });

  const vcs = command.get('vcs');
  const methodName = command.get('method').replace(/-/g, '');

  try {
    Commands.commands.execute(vcs, methodName, this, this.command);
  } catch (error) {
    this.filterError(error);
    // short circuit animation by just setting error and returning
    command.set('error', error);
    deferred.resolve();
    return;
  }

  const willStartAuto = this.animationQueue.get('defer')
    || this.animationQueue.get('promiseBased');

  // only add the refresh if we didn't do manual animations
  if (this.animationQueue.get('animations').length === 0 && !willStartAuto) {
    this.animationFactory.refreshTree(this.animationQueue, this.gitVisuals);
  }

  // animation queue will call the callback when its done
  if (!willStartAuto) {
    this.animationQueue.start();
  }
};

GitEngine.prototype.show = function (reference) {
  const commit = this.getCommitFromRef(reference);

  throw new CommandResult({
    msg: commit.getShowEntry(),
  });
};

GitEngine.prototype.status = function () {
  // UGLY todo
  const lines = [];
  if (this.getDetachedHead()) {
    lines.push(intl.str('git-status-detached'));
  } else {
    const branchName = this.HEAD.get('target').get('id');
    lines.push(intl.str('git-status-onbranch', { branch: branchName }));
  }
  lines.push('Changes to be committed:', '', `${TAB}modified: cal/OskiCostume.stl`, '');
  lines.push(intl.str('git-status-readytocommit'));

  let message = '';
  for (const line of lines) {
    message += `# ${line}\n`;
  }

  throw new CommandResult({
    msg: message,
  });
};

GitEngine.prototype.logWithout = function (reference, omitBranch) {
  // slice off the ^branch
  omitBranch = omitBranch.slice(1);
  this.log(reference, Graph.getUpstreamSet(this, omitBranch));
};

GitEngine.prototype.revlist = function (references) {
  const range = new RevisionRange(this, references);

  // now go through and collect ids
  const bigLogString = range.formatRevisions((c) => `${c.id}\n`);

  throw new CommandResult({
    msg: bigLogString,
  });
};

GitEngine.prototype.log = function (references) {
  const range = new RevisionRange(this, references);

  // now go through and collect logs
  const bigLogString = range.formatRevisions((c) => c.getLogEntry());

  throw new CommandResult({
    msg: bigLogString,
  });
};

GitEngine.prototype.getCommonAncestor = function (ancestor, cousin, dontThrow) {
  if (this.isUpstreamOf(cousin, ancestor) && !dontThrow) {
    throw new Error("Don't use common ancestor if we are upstream!");
  }

  const upstreamSet = Graph.getUpstreamSet(this, ancestor);
  // now BFS off of cousin until you find something

  let queue = [this.getCommitFromRef(cousin)];
  while (queue.length > 0) {
    const here = queue.pop();
    if (upstreamSet[here.get('id')]) {
      return here;
    }
    queue = queue.concat(here.get('parents'));
  }
  throw new Error("something has gone very wrong... two nodes aren't connected!");
};

GitEngine.prototype.isUpstreamOf = function (child, ancestor) {
  child = this.getCommitFromRef(child);

  // basically just do a completely BFS search on ancestor to the root, then
  // check for membership of child in that set of explored nodes
  const upstream = Graph.getUpstreamSet(this, ancestor);
  return upstream[child.get('id')] !== undefined;
};

GitEngine.prototype.getDownstreamSet = function (ancestor) {
  const commit = this.getCommitFromRef(ancestor);

  const ancestorID = commit.get('id');
  const queue = [commit];

  const exploredSet = {};
  exploredSet[ancestorID] = true;

  const addToExplored = function (child) {
    exploredSet[child.get('id')] = true;
    queue.push(child);
  };

  while (queue.length > 0) {
    const here = queue.pop();
    const children = here.get('children');

    children.forEach(addToExplored);
  }
  return exploredSet;
};

var Reference = Backbone.Model.extend({
  initialize() {
    if (!this.get('target')) {
      throw new Error('must be initialized with target');
    }
    if (!this.get('id')) {
      throw new Error('must be given an id');
    }
    this.set('type', 'general ref');

    if (this.get('id') == 'HEAD') {
      this.set('lastLastTarget', null);
      this.set('lastTarget', this.get('target'));
      // have HEAD remember where it is for checkout -
      this.on('change:target', this.targetChanged, this);
    }
  },

  getIsRemote() {
    return false;
  },

  getName() {
    return this.get('id');
  },

  targetChanged(model, targetValue, event) {
    // push our little 3 stack back. we need to do this because
    // backbone doesn't give you what the value WAS, only what it was changed
    // TO
    this.set('lastLastTarget', this.get('lastTarget'));
    this.set('lastTarget', targetValue);
  },

  toString() {
    return `a ${this.get('type')}pointing to ${String(this.get('target'))}`;
  },
});

var Branch = Reference.extend({
  defaults: {
    visBranch: null,
    remoteTrackingBranchID: null,
    remote: false,
  },

  initialize() {
    Reference.prototype.initialize.call(this);
    this.set('type', 'branch');
  },

  /**
   * Here is the deal -- there are essentially three types of branches
   * we deal with:
   * 1) Normal local branches (that may track a remote branch)
   * 2) Local remote branches (o/master) that track an origin branch
   * 3) Origin branches (master) that exist in origin
   *
   * With that in mind, we change our branch model to support the following
   */
  setRemoteTrackingBranchID(id) {
    this.set('remoteTrackingBranchID', id);
  },

  getRemoteTrackingBranchID() {
    return this.get('remoteTrackingBranchID');
  },

  getPrefixedID() {
    if (this.getIsRemote()) {
      throw new Error('im already remote');
    }
    return ORIGIN_PREFIX + this.get('id');
  },

  getBaseID() {
    if (!this.getIsRemote()) {
      throw new Error("im not remote so can't get base");
    }
    return this.get('id').replace(ORIGIN_PREFIX, '');
  },

  getIsRemote() {
    if (typeof this.get('id') !== 'string') {
      debugger;
    }
    return this.get('id').slice(0, 2) === ORIGIN_PREFIX;
  },
});

var Commit = Backbone.Model.extend({
  defaults: {
    type: 'commit',
    children: null,
    parents: null,
    author: 'Peter Cottle',
    createTime: null,
    commitMessage: null,
    visNode: null,
    gitVisuals: null,
  },

  constants: {
    circularFields: ['gitVisuals', 'visNode', 'children'],
  },

  getLogEntry() {
    return `${[
      `Author: ${this.get('author')}`,
      `Date: ${this.get('createTime')}`,
      '',
      this.get('commitMessage'),
      '',
      `Commit: ${this.get('id')}`,
    ].join('<br/>')}\n`;
  },

  getShowEntry() {
    // same deal as above, show log entry and some fake changes
    return `${[
      this.getLogEntry().replace('\n', ''),
      'diff --git a/bigGameResults.html b/bigGameResults.html',
      '--- bigGameResults.html',
      '+++ bigGameResults.html',
      '@@ 13,27 @@ Winner, Score',
      '- Stanfurd, 14-7',
      '+ Cal, 21-14',
    ].join('<br/>')}\n`;
  },

  validateAtInit() {
    if (!this.get('id')) {
      throw new Error('Need ID!!');
    }

    if (!this.get('createTime')) {
      this.set('createTime', new Date().toString());
    }
    if (!this.get('commitMessage')) {
      this.set('commitMessage', intl.str('git-dummy-msg'));
    }

    this.set('children', []);

    // root commits have no parents
    if (!this.get('rootCommit') && (!this.get('parents') || this.get('parents').length === 0)) {
      throw new Error('needs parents');
    }
  },

  addNodeToVisuals() {
    const visNode = this.get('gitVisuals').addNode(this.get('id'), this);
    this.set('visNode', visNode);
  },

  addEdgeToVisuals(parent) {
    this.get('gitVisuals').addEdge(this.get('id'), parent.get('id'));
  },

  getParent(parentNumber) {
    if (this && this.attributes && this.attributes.parents) {
      return this.attributes.parents[parentNumber];
    }
    return null;
  },

  removeFromParents() {
    this.get('parents').forEach(function (parent) {
      this.remove();
    }, this);
  },

  checkForUpdatedParent(engine) {
    const parents = this.get('parents');
    if (parents.length > 1) {
      return;
    }
    const parent = parents[0];
    const parentID = parent.get('id');
    const newestID = engine.getMostRecentBumpedID(parentID);

    if (parentID === newestID) {
      // BOOM done, its already updated
      return;
    }

    // crap we have to switch
    const newParent = engine.refs[newestID];

    this.removeFromParents();
    this.set('parents', [newParent]);
    newParent.get('children').push(this);

    // when we run in test mode, our visnode and
    // visuals will be undefined so we need to check for their existence
    const visNode = this.get('visNode');
    if (visNode) {
      visNode.removeAllEdges();
    }

    const gitVisuals = this.get('gitVisuals');
    if (gitVisuals) {
      gitVisuals.addEdge(this.get('id'), newestID);
    }

    return true;
  },

  removeChild(childToRemove) {
    const newChildren = [];
    for (const child of this.get('children')) {
      if (child !== childToRemove) {
        newChildren.push(child);
      }
    }
    this.set('children', newChildren);
  },

  isMainParent(parent) {
    const index = this.get('parents').indexOf(parent);
    return index === 0;
  },

  initialize(options) {
    this.validateAtInit();
    this.addNodeToVisuals();

    (this.get('parents') || []).forEach(function (parent) {
      parent.get('children').push(this);
      this.addEdgeToVisuals(parent);
    }, this);
  },
});

var Tag = Reference.extend({
  defaults: {
    visTag: null,
  },

  initialize() {
    Reference.prototype.initialize.call(this);
    this.set('type', 'tag');
  },
});

function RevisionRange(engine, specifiers) {
  this.engine = engine;
  this.tipsToInclude = [];
  this.tipsToExclude = [];
  this.includedRefs = {};
  this.excludedRefs = {};
  this.revisions = [];

  this.processSpecifiers(specifiers);
}

const rangeRegex = /^(.*)\.\.(.*)$/;

RevisionRange.prototype.processAsRange = function (specifier) {
  const match = specifier.match(rangeRegex);
  if (!match) {
    return false;
  }
  this.tipsToExclude.push(match[1]);
  this.tipsToInclude.push(match[2]);
  return true;
};

RevisionRange.prototype.processAsExclusion = function (specifier) {
  if (!specifier.startsWith('^')) {
    return false;
  }
  this.tipsToExclude.push(specifier.slice(1));
  return true;
};

RevisionRange.prototype.processAsInclusion = function (specifier) {
  this.tipsToInclude.push(specifier);
  return true;
};

RevisionRange.prototype.processSpecifiers = function (specifiers) {
  const self = this;
  const processors = [
    this.processAsRange,
    this.processAsExclusion,
  ];

  for (const specifier of specifiers) {
    if (!processors.some((processor) => processor.bind(self)(specifier))) {
      self.processAsInclusion(specifier);
    }
  }

  for (const exclusion of this.tipsToExclude) {
    self.addExcluded(Graph.getUpstreamSet(self.engine, exclusion));
  }

  for (const inclusion of this.tipsToInclude) {
    self.addIncluded(Graph.getUpstreamSet(self.engine, inclusion));
  }

  const includedKeys = [...Object.keys(self.includedRefs)];

  self.revisions = includedKeys.map((revision) => self.engine.resolveStringRef(revision));
  self.revisions.sort(self.engine.dateSortFunc);
  self.revisions.reverse();
};

RevisionRange.prototype.isExcluded = function (revision) {
  return this.excludedRefs.hasOwnProperty(revision);
};

RevisionRange.prototype.addExcluded = function (setToExclude) {
  const self = this;
  for (const toExclude of Object.keys(setToExclude)) {
    if (!self.isExcluded(toExclude)) {
      self.excludedRefs[toExclude] = true;
    }
  }
};

RevisionRange.prototype.addIncluded = function (setToInclude) {
  const self = this;
  for (const toInclude of Object.keys(setToInclude)) {
    if (!self.isExcluded(toInclude)) {
      self.includedRefs[toInclude] = true;
    }
  }
};

RevisionRange.prototype.formatRevisions = function (revisionFormatter) {
  let output = '';
  for (const c of this.revisions) {
    output += revisionFormatter(c);
  }
  return output;
};

exports.GitEngine = GitEngine;
exports.Commit = Commit;
exports.Branch = Branch;
exports.Tag = Tag;
exports.Ref = Reference;
