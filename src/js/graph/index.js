function invariant(truthy, reason) {
  if (!truthy) {
    throw new Error(reason);
  }
}

const Graph = {

  getOrMakeRecursive(
    tree,
    createdSoFar,
    objectID,
    gitVisuals,
  ) {
    // circular dependency, should move these base models OUT of
    // the git class to resolve this
    const Git = require('../git');
    const { Commit } = Git;
    const { Ref } = Git;
    const { Branch } = Git;
    const { Tag } = Git;
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
      const HEAD = new Ref(Object.assign(
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

      const parentObjs = [];
      commitJSON.parents.forEach(function (parentID) {
        parentObjs.push(this.getOrMakeRecursive(tree, createdSoFar, parentID));
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
  },

  descendSortDepth(objects) {
    return objects.sort((oA, oB) => oB.depth - oA.depth);
  },

  bfsFromLocationWithSet(engine, location, set) {
    const result = [];
    let pQueue = [engine.getCommitFromRef(location)];

    while (pQueue.length > 0) {
      const popped = pQueue.pop();
      if (set[popped.get('id')]) {
        continue;
      }

      result.push(popped);
      // keep searching
      pQueue = pQueue.concat(popped.get('parents'));
    }
    return result;
  },

  getUpstreamSet(engine, ancestor) {
    const commit = engine.getCommitFromRef(ancestor);
    const ancestorID = commit.get('id');
    const queue = [commit];

    const exploredSet = {};
    exploredSet[ancestorID] = true;

    const addToExplored = function (rent) {
      exploredSet[rent.get('id')] = true;
      queue.push(rent);
    };

    while (queue.length > 0) {
      const here = queue.pop();
      const rents = here.get('parents');

      (rents || []).forEach(addToExplored);
    }
    return exploredSet;
  },

  getUniqueObjects(objects) {
    const unique = {};
    const result = [];
    for (const object of objects) {
      if (unique[object.id]) {
        continue;
      }
      unique[object.id] = true;
      result.push(object);
    }
    return result;
  },

  getDefaultTree() {
    return JSON.parse(unescape('%7B%22branches%22%3A%7B%22master%22%3A%7B%22target%22%3A%22C1%22%2C%22id%22%3A%22master%22%2C%22type%22%3A%22branch%22%7D%7D%2C%22commits%22%3A%7B%22C0%22%3A%7B%22type%22%3A%22commit%22%2C%22parents%22%3A%5B%5D%2C%22author%22%3A%22Peter%20Cottle%22%2C%22createTime%22%3A%22Mon%20Nov%2005%202012%2000%3A56%3A47%20GMT-0800%20%28PST%29%22%2C%22commitMessage%22%3A%22Quick%20Commit.%20Go%20Bears%21%22%2C%22id%22%3A%22C0%22%2C%22rootCommit%22%3Atrue%7D%2C%22C1%22%3A%7B%22type%22%3A%22commit%22%2C%22parents%22%3A%5B%22C0%22%5D%2C%22author%22%3A%22Peter%20Cottle%22%2C%22createTime%22%3A%22Mon%20Nov%2005%202012%2000%3A56%3A47%20GMT-0800%20%28PST%29%22%2C%22commitMessage%22%3A%22Quick%20Commit.%20Go%20Bears%21%22%2C%22id%22%3A%22C1%22%7D%7D%2C%22HEAD%22%3A%7B%22id%22%3A%22HEAD%22%2C%22target%22%3A%22master%22%2C%22type%22%3A%22general%20ref%22%7D%7D'));
  },
};

module.exports = Graph;
