const _ = require('underscore');

// static class...
const TreeCompare = {};

TreeCompare.dispatchFromLevel = function (levelBlob, treeToCompare) {
  const { goalTreeString } = levelBlob;
  if (typeof treeToCompare !== 'string') {
    console.warn('NEED to pass in string!! gah');
  }
  return TreeCompare.dispatch(levelBlob, goalTreeString, treeToCompare);
};

TreeCompare.onlyMasterCompared = function (levelBlob) {
  const getAroundLintTrue = true;
  switch (getAroundLintTrue) {
    case !!levelBlob.compareOnlyMaster:
    case !!levelBlob.compareOnlyMasterHashAgnostic:
    case !!levelBlob.compareOnlyMasterHashAgnosticWithAsserts:
      return true;
    default:
      return false;
  }
};

TreeCompare.dispatch = function (levelBlob, goalTreeString, treeToCompare) {
  const goalTree = this.convertTreeSafe(goalTreeString);
  treeToCompare = this.convertTreeSafe(treeToCompare);
  if (typeof goalTree.originTree !== typeof treeToCompare.originTree) {
    // origin status does not match
    return false;
  }
  const shallowResult = this.dispatchShallow(
    levelBlob, goalTree, treeToCompare,
  );
  if (!shallowResult || !goalTree.originTree) {
    // we only have one level (or failed on shallow), punt
    return shallowResult;
  }

  const originBlob = (levelBlob.originCompare)
    ? levelBlob.originCompare : levelBlob;
  // compare origin trees
  return shallowResult && this.dispatchShallow(
    originBlob, goalTree.originTree, treeToCompare.originTree,
  );
};

TreeCompare.dispatchShallow = function (levelBlob, goalTreeString, treeToCompare) {
  const getAroundLintTrue = true;
  // i actually prefer this to else if
  switch (getAroundLintTrue) {
    case !!levelBlob.compareOnlyMaster:
      return TreeCompare.compareBranchWithinTrees(
        treeToCompare, goalTreeString, 'master',
      );
    case !!levelBlob.compareAllBranchesAndEnforceBranchCleanup:
      return TreeCompare.compareAllBranchesAndEnforceBranchCleanup(
        treeToCompare, goalTreeString,
      );
    case !!levelBlob.compareOnlyBranches:
      return TreeCompare.compareAllBranchesWithinTrees(
        treeToCompare, goalTreeString,
      );
    case !!levelBlob.compareAllBranchesHashAgnostic:
      return TreeCompare.compareAllBranchesWithinTreesHashAgnostic(
        treeToCompare, goalTreeString,
      );
    case !!levelBlob.compareOnlyMasterHashAgnostic:
      return TreeCompare.compareBranchesWithinTreesHashAgnostic(
        treeToCompare, goalTreeString, ['master'],
      );
    case !!levelBlob.compareOnlyMasterHashAgnosticWithAsserts:
      return TreeCompare.compareBranchesWithinTreesHashAgnostic(
        treeToCompare, goalTreeString, ['master'],
      ) && TreeCompare.evalAsserts(treeToCompare, levelBlob.goalAsserts);
    default:
      return TreeCompare.compareAllBranchesWithinTreesAndHEAD(
        treeToCompare, goalTreeString,
      );
  }
};

// would love to have copy properties here.. :(
TreeCompare.compareAllBranchesWithinTreesAndHEAD = function (treeToCompare, goalTree) {
  treeToCompare = this.convertTreeSafe(treeToCompare);
  goalTree = this.convertTreeSafe(goalTree);

  // also compare tags!! for just one level
  return treeToCompare.HEAD.target === goalTree.HEAD.target
    && this.compareAllBranchesWithinTrees(treeToCompare, goalTree)
    && this.compareAllTagsWithinTrees(treeToCompare, goalTree);
};

TreeCompare.compareAllBranchesAndEnforceBranchCleanup = function (treeToCompare, goalTree) {
  treeToCompare = this.convertTreeSafe(treeToCompare);
  goalTree = this.convertTreeSafe(goalTree);

  // Unlike compareAllBranchesWithinTrees, here we consider both the branches
  // in the goalTree and the branches in the treeToCompare. This means that
  // we enfoce that you clean up any branches that you have locally that
  // the goal does not have. this is helpful when we want to verify that you
  // have deleted branch, for instance.
  const allBranches = {

    ...treeToCompare.branches,
    ...goalTree.branches,
  };
  return Object.keys(allBranches).every((branch) => this.compareBranchWithinTrees(treeToCompare, goalTree, branch));
};

TreeCompare.compareAllBranchesWithinTrees = function (treeToCompare, goalTree) {
  treeToCompare = this.convertTreeSafe(treeToCompare);
  goalTree = this.convertTreeSafe(goalTree);

  /**
   * Disclaimer / reminder!! We only care about branches in the goal tree;
   * if you have extra branches in your source tree thats ok. but that means
   * the arguments here are important -- always call this function with
   * goalTree being the latter argument, since we will discard extra branches
   * from treeToCompare (the first argument).
   */
  return Object.keys(goalTree.branches).every((branch) => this.compareBranchWithinTrees(treeToCompare, goalTree, branch));
};

TreeCompare.compareAllTagsWithinTrees = function (treeToCompare, goalTree) {
  treeToCompare = this.convertTreeSafe(treeToCompare);
  goalTree = this.convertTreeSafe(goalTree);
  this.reduceTreeFields([treeToCompare, goalTree]);

  return _.isEqual(treeToCompare.tags, goalTree.tags);
};

TreeCompare.compareBranchesWithinTrees = function (treeToCompare, goalTree, branches) {
  let result = true;
  branches.forEach(function (branchName) {
    result = result && this.compareBranchWithinTrees(treeToCompare, goalTree, branchName);
  }, this);

  return result;
};

TreeCompare.compareBranchWithinTrees = function (treeToCompare, goalTree, branchName) {
  treeToCompare = this.convertTreeSafe(treeToCompare);
  goalTree = this.convertTreeSafe(goalTree);
  this.reduceTreeFields([treeToCompare, goalTree]);

  const recurseCompare = this.getRecurseCompare(treeToCompare, goalTree);
  const branchA = treeToCompare.branches[branchName];
  const branchB = goalTree.branches[branchName];

  return _.isEqual(branchA, branchB)
    && recurseCompare(treeToCompare.commits[branchA.target], goalTree.commits[branchB.target]);
};

TreeCompare.compareAllBranchesWithinTreesHashAgnostic = function (treeToCompare, goalTree) {
  treeToCompare = this.convertTreeSafe(treeToCompare);
  goalTree = this.convertTreeSafe(goalTree);
  this.reduceTreeFields([treeToCompare, goalTree]);

  const allBranches = {

    ...treeToCompare.branches,
    ...goalTree.branches,
  };
  const branchNames = Object.keys(allBranches || {});

  return this.compareBranchesWithinTreesHashAgnostic(treeToCompare, goalTree, branchNames);
};

TreeCompare.compareBranchesWithinTreesHashAgnostic = function (treeToCompare, goalTree, branches) {
  // we can't DRY unfortunately here because we need a special _.isEqual function
  // for both the recursive compare and the branch compare
  treeToCompare = this.convertTreeSafe(treeToCompare);
  goalTree = this.convertTreeSafe(goalTree);
  this.reduceTreeFields([treeToCompare, goalTree]);

  // get a function to compare branch objects without hashes
  const compareBranchObjs = function (branchA, branchB) {
    if (!branchA || !branchB) {
      return false;
    }

    // don't mess up the rest of comparison
    branchA = { ...branchA };
    branchB = { ...branchB };
    branchA.target = this.getBaseRef(branchA.target);
    branchB.target = this.getBaseRef(branchB.target);

    return _.isEqual(branchA, branchB);
  }.bind(this);
  // and a function to compare recursively without worrying about hashes
  const recurseCompare = this.getRecurseCompareHashAgnostic(treeToCompare, goalTree);

  let result = true;
  branches.forEach((branchName) => {
    const branchA = treeToCompare.branches[branchName];
    const branchB = goalTree.branches[branchName];

    result = result && compareBranchObjs(branchA, branchB)
      && recurseCompare(treeToCompare.commits[branchA.target], goalTree.commits[branchB.target]);
  }, this);
  return result;
};

TreeCompare.evalAsserts = function (tree, assertsPerBranch) {
  let result = true;
  Object.keys(assertsPerBranch).forEach(function (branchName) {
    const asserts = assertsPerBranch[branchName];
    result = result && this.evalAssertsOnBranch(tree, branchName, asserts);
  }, this);
  return result;
};

TreeCompare.evalAssertsOnBranch = function (tree, branchName, asserts) {
  tree = this.convertTreeSafe(tree);

  // here is the outline:
  // * make a data object
  // * go to the branch given by the key
  // * traverse upwards, storing the amount of hashes on each in the data object
  // * then come back and perform functions on data

  if (!tree.branches[branchName]) {
    return false;
  }

  const branch = tree.branches[branchName];
  let queue = [branch.target];
  const data = {};
  while (queue.length > 0) {
    const commitReference = queue.pop();
    data[this.getBaseRef(commitReference)] = this.getNumHashes(commitReference);
    queue = queue.concat(tree.commits[commitReference].parents);
  }

  let result = true;
  for (const assert of asserts) {
    try {
      result = result && assert(data);
    } catch (error) {
      console.warn('error during assert', error);
      console.log(error);
      result = false;
    }
  }

  return result;
};

TreeCompare.getNumHashes = function (reference) {
  const regexMap = [
    [/^C(\d+)('{0,3})$/, function (bits) {
      if (!bits[2]) {
        return 0;
      }
      return bits[2].length;
    }],
    [/^C(\d+)'\^(\d+)$/, function (bits) {
      return Number(bits[2]);
    }],
  ];

  for (const element of regexMap) {
    const regex = element[0];
    const function_ = element[1];
    const results = regex.exec(reference);
    if (results) {
      return function_(results);
    }
  }
  throw new Error(`couldn't parse ref ${reference}`);
};

TreeCompare.getBaseRef = function (reference) {
  const idRegex = /^C(\d+)/;
  const bits = idRegex.exec(reference);
  if (!bits) { throw new Error(`no regex matchy for ${reference}`); }
  // no matter what hash this is (aka C1', C1'', C1'^3, etc) we
  // return C1
  return `C${bits[1]}`;
};

TreeCompare.getRecurseCompareHashAgnostic = function (treeToCompare, goalTree) {
  // here we pass in a special comparison function to pass into the base
  // recursive compare.

  // some buildup functions
  const getStrippedCommitCopy = function (commit) {
    if (!commit) { return {}; }
    return {

      ...commit,
      id: this.getBaseRef(commit.id),
      parents: null,
    };
  }.bind(this);

  const isEqual = function (commitA, commitB) {
    return _.isEqual(
      getStrippedCommitCopy(commitA),
      getStrippedCommitCopy(commitB),
    );
  };
  return this.getRecurseCompare(treeToCompare, goalTree, { isEqual });
};

TreeCompare.getRecurseCompare = function (treeToCompare, goalTree, options) {
  options = options || {};

  // we need a recursive comparison function to bubble up the branch
  var recurseCompare = function (commitA, commitB) {
    // this is the short-circuit base case
    let result = options.isEqual
      ? options.isEqual(commitA, commitB) : _.isEqual(commitA, commitB);
    if (!result) {
      return false;
    }

    // we loop through each parent ID. we sort the parent ID's beforehand
    // so the index lookup is valid. for merge commits this will duplicate some of the
    // checking (because we aren't doing graph search) but it's not a huge deal
    const maxNumberParents = Math.max(commitA.parents.length, commitB.parents.length);
    for (let index = 0; index < maxNumberParents; index++) {
      const pAid = commitA.parents[index];
      const pBid = commitB.parents[index];

      // if treeToCompare or goalTree doesn't have this parent,
      // then we get an undefined child which is fine when we pass into _.isEqual
      const childA = treeToCompare.commits[pAid];
      const childB = goalTree.commits[pBid];

      result = result && recurseCompare(childA, childB);
    }
    // if each of our children recursively are equal, we are good
    return result;
  };
  return recurseCompare;
};

TreeCompare.lowercaseTree = function (tree) {
  if (tree.HEAD) {
    tree.HEAD.target = tree.HEAD.target.toLocaleLowerCase();
  }

  const branches = tree.branches || {};
  tree.branches = {};
  for (const name of Object.keys(branches)) {
    const object = branches[name];
    object.id = object.id.toLocaleLowerCase();
    tree.branches[name.toLocaleLowerCase()] = object;
  }
  return tree;
};

TreeCompare.convertTreeSafe = function (tree) {
  if (typeof tree !== 'string') {
    return tree;
  }
  tree = JSON.parse(unescape(tree));
  // ok we are almost done -- but we need to case insensitive
  // certain fields. so go ahead and do that.
  // handle HEAD target first
  this.lowercaseTree(tree);
  if (tree.originTree) {
    tree.originTree = this.lowercaseTree(tree.originTree);
  }
  return tree;
};

TreeCompare.reduceTreeFields = function (trees) {
  const commitSaveFields = [
    'parents',
    'id',
    'rootCommit',
  ];
  const branchSaveFields = [
    'target',
    'id',
    'remoteTrackingBranchID',
  ];
  const tagSaveFields = [
    'target',
    'id',
  ];

  const commitSortFields = ['children', 'parents'];
  // for backwards compatibility, fill in some fields if missing
  const defaults = {
    remoteTrackingBranchID: null,
  };
  // also fill tree-level defaults
  const treeDefaults = {
    tags: {},
  };

  for (const tree of trees) {
    for (const key of Object.keys(treeDefaults)) {
      const value = treeDefaults[key];
      if (tree[key] === undefined) {
        tree[key] = value;
      }
    }
  }

  // this function saves only the specified fields of a tree
  const saveOnly = function (tree, treeKey, saveFields, sortFields) {
    const objects = tree[treeKey];
    for (const objectKey of Object.keys(objects)) {
      const object = objects[objectKey];
      // our blank slate to copy over
      const blank = {};
      for (const field of saveFields) {
        if (object[field] !== undefined) {
          blank[field] = object[field];
        } else if (defaults[field] !== undefined) {
          blank[field] = defaults[field];
        }
      }

      for (const field of Object.values(sortFields || {})) {
        // also sort some fields
        if (object[field]) {
          object[field].sort();
          blank[field] = object[field];
        }
      }
      tree[treeKey][objectKey] = blank;
    }
  };

  trees.forEach(function (tree) {
    saveOnly(tree, 'commits', commitSaveFields, commitSortFields);
    saveOnly(tree, 'branches', branchSaveFields);
    saveOnly(tree, 'tags', tagSaveFields);

    tree.HEAD = {
      target: tree.HEAD.target,
      id: tree.HEAD.id,
    };
    if (tree.originTree) {
      this.reduceTreeFields([tree.originTree]);
    }
  }, this);
};

TreeCompare.compareTrees = function (treeToCompare, goalTree) {
  treeToCompare = this.convertTreeSafe(treeToCompare);
  goalTree = this.convertTreeSafe(goalTree);

  // now we need to strip out the fields we don't care about, aka things
  // like createTime, message, author
  this.reduceTreeFields([treeToCompare, goalTree]);

  return _.isEqual(treeToCompare, goalTree);
};

module.exports = TreeCompare;
