const Q = require('q');

const intl = require('../intl');
const { GRAPHICS } = require('../util/constants');
const debounce = require('../util/debounce');
const GlobalStateStore = require('../stores/GlobalStateStore');

const { VisNode } = require('./visNode');
const { VisBranch } = require('./visBranch');
const { VisBranchCollection } = require('./visBranch');
const { VisTag } = require('./visTag');
const { VisTagCollection } = require('./visTag');
const { VisEdge } = require('./visEdge');
const { VisEdgeCollection } = require('./visEdge');

function GitVisuals(options) {
  options = options || {};
  this.options = options;
  this.visualization = options.visualization;
  this.commitCollection = options.commitCollection;
  this.branchCollection = options.branchCollection;
  this.tagCollection = options.tagCollection;
  this.visNodeMap = {};

  this.visEdgeCollection = new VisEdgeCollection();
  this.visBranchCollection = new VisBranchCollection();
  this.visTagCollection = new VisTagCollection();
  this.commitMap = {};

  this.rootCommit = null;
  this.branchStackMap = null;
  this.tagStackMap = null;
  this.upstreamBranchSet = null;
  this.upstreamTagSet = null;
  this.upstreamHeadSet = null;

  this.paper = options.paper;
  this.gitReady = false;

  this.branchCollection.on('add', this.addBranchFromEvent, this);
  this.branchCollection.on('remove', this.removeBranch, this);

  this.tagCollection.on('add', this.addTagFromEvent, this);
  this.tagCollection.on('remove', this.removeTag, this);

  this.deferred = [];

  this.flipFraction = 0.65;

  const Main = require('../app');
  const that = this;
  this._onRefreshTree = function () { that.refreshTree(); };
  Main.getEvents().on('refreshTree', this._onRefreshTree, this);
}

GitVisuals.prototype.defer = function (action) {
  this.deferred.push(action);
};

GitVisuals.prototype.deferFlush = function () {
  this.deferred.forEach((action) => {
    action();
  }, this);
  this.deferred = [];
};

GitVisuals.prototype.resetAll = function () {
  // make sure to copy these collections because we remove
  // items in place and underscore is too dumb to detect length change
  const edges = this.visEdgeCollection.toArray();
  edges.forEach((visEdge) => {
    visEdge.remove();
  }, this);

  const branches = this.visBranchCollection.toArray();
  branches.forEach((visBranch) => {
    visBranch.remove();
  }, this);

  const tags = this.visTagCollection.toArray();
  tags.forEach((visTag) => {
    visTag.remove();
  }, this);

  Object.values(this.visNodeMap).forEach((visNode) => {
    visNode.remove();
  }, this);

  this.visEdgeCollection.reset();
  this.visBranchCollection.reset();
  this.visTagCollection.reset();

  this.visNodeMap = {};
  this.rootCommit = null;
  this.commitMap = {};
};

GitVisuals.prototype.tearDown = function () {
  this.resetAll();
  this.paper.remove();
  // Unregister the refresh tree listener so we don't accumulate
  // these over time. However we aren't calling tearDown in
  // some places... but this is an improvement
  const Main = require('../app');
  Main.getEvents().removeListener('refreshTree', this._onRefreshTree);
};

GitVisuals.prototype.assignGitEngine = function (gitEngine) {
  this.gitEngine = gitEngine;
  this.initHeadBranch();
  this.deferFlush();
};

GitVisuals.prototype.getVisualization = function () {
  return this.visualization;
};

GitVisuals.prototype.initHeadBranch = function () {
  // it's unfortaunte we have to do this, but the head branch
  // is an edge case because it's not part of a collection so
  // we can't use events to load or unload it. thus we have to call
  // this ugly method which will be deleted one day

  // seed this with the HEAD pseudo-branch
  this.addBranchFromEvent(this.gitEngine.HEAD);
};

GitVisuals.prototype.getScreenPadding = function () {
  // if we are flipping the tree, the helper bar gets in the way
  const topFactor = (GlobalStateStore.getFlipTreeY()) ? 3 : 1.5;

  // for now we return the node radius subtracted from the walls
  return {
    widthPadding: GRAPHICS.nodeRadius * 1.5,
    topHeightPadding: GRAPHICS.nodeRadius * topFactor,
    // we pad the bottom a lot more so the branches wont go off screen
    bottomHeightPadding: GRAPHICS.nodeRadius * 5,
  };
};

GitVisuals.prototype.getPosBoundaries = function () {
  if (this.gitEngine.hasOrigin()) {
    return {
      min: 0,
      max: 0.5,
    };
  } if (this.gitEngine.isOrigin()) {
    return {
      min: 0.5,
      max: 1,
    };
  }
  return {
    min: 0,
    max: 1,
  };
};

GitVisuals.prototype.getFlipPos = function () {
  const bounds = this.getPosBoundaries();
  const { min } = bounds;
  const { max } = bounds;
  return this.flipFraction * (max - min) + min;
};

GitVisuals.prototype.getIsGoalVis = function () {
  return !!this.options.isGoalVis;
};

GitVisuals.prototype.getLevelBlob = function () {
  return this.visualization.options.levelBlob || {};
};

GitVisuals.prototype.toScreenCoords = function (pos) {
  if (!this.paper.width) {
    throw new Error('being called too early for screen coords');
  }
  const padding = this.getScreenPadding();

  const shrink = function (frac, total, padding) {
    return padding + frac * (total - padding * 2);
  };

  const asymShrink = function (frac, total, paddingTop, paddingBelow) {
    return paddingTop + frac * (total - paddingBelow - paddingTop);
  };

  const x = shrink(pos.x, this.paper.width, padding.widthPadding);
  let y = asymShrink(pos.y, this.paper.height, padding.topHeightPadding, padding.bottomHeightPadding);

  if (GlobalStateStore.getFlipTreeY()) {
    y = this.paper.height - y;
  }

  return { x, y };
};

GitVisuals.prototype.animateAllAttrKeys = function (keys, attribute, speed, easing) {
  const deferred = Q.defer();

  const animate = function (visObj) {
    visObj.animateAttrKeys(keys, attribute, speed, easing);
  };

  this.visBranchCollection.each(animate);
  this.visEdgeCollection.each(animate);
  this.visTagCollection.each(animate);
  Object.values(this.visNodeMap).forEach(animate);

  const time = (speed !== undefined) ? speed : GRAPHICS.defaultAnimationTime;
  setTimeout(() => {
    deferred.resolve();
  }, time);

  return deferred.promise;
};

GitVisuals.prototype.finishAnimation = function (speed) {
  speed = speed || 1;
  if (!speed) {
    throw new Error(`need speed by time i finish animation${speed}`);
  }

  const _this = this;
  const deferred = Q.defer();
  const animationDone = Q.defer();
  const defaultTime = GRAPHICS.defaultAnimationTime;
  const { nodeRadius } = GRAPHICS;

  const textString = intl.str('solved-level');
  let text = null;
  const makeText = function () {
    text = this.paper.text(
      this.paper.width / 2,
      this.paper.height / 2,
      textString,
    );
    text.attr({
      opacity: 0,
      'font-weight': 500,
      'font-size': '32pt',
      'font-family': 'Menlo, Monaco, Consolas, \'Droid Sans Mono\', monospace',
      stroke: '#000',
      'stroke-width': 2,
      fill: '#000',
    });
    text.animate({ opacity: 1 }, defaultTime);
  }.bind(this);

  // this is a BIG ANIMATION but it ends up just being
  // a sweet chain of promises but is pretty nice. this is
  // after I discovered promises / deferred's. Unfortunately
  // I wrote a lot of the git stuff before promises, so
  // that's somewhat ugly

  deferred.promise
  // first fade out everything but circles
    .then(() => this.animateAllAttrKeys(
      { exclude: ['circle'] },
      { opacity: 0 },
      defaultTime * 1.1 / speed,
    ))
  // then make circle radii bigger
    .then(() => this.animateAllAttrKeys(
      { exclude: ['arrow', 'rect', 'path', 'text'] },
      { r: nodeRadius * 2 },
      defaultTime * 1.5 / speed,
    ))
  // then shrink em super fast
    .then(() => this.animateAllAttrKeys(
      { exclude: ['arrow', 'rect', 'path', 'text'] },
      { r: nodeRadius * 0.75 },
      defaultTime * 0.5 / speed,
    ))
  // then explode them and display text
    .then(() => {
      makeText();
      return this.explodeNodes(speed);
    })
    .then(() => this.explodeNodes(speed))
  // then fade circles (aka everything) in and back
    .then(() => this.animateAllAttrKeys(
      { exclude: ['arrow', 'rect', 'path', 'text'] },
      {},
      defaultTime * 1.25,
    ))
  // then fade everything in and remove text
    .then(() => {
      text.animate({ opacity: 0 }, defaultTime, undefined, undefined, () => {
        text.remove();
      });
      return this.animateAllAttrKeys(
        {},
        {},
      );
    })
    .then(() => {
      animationDone.resolve();
    })
    .fail((reason) => {
      console.warn(`animation error${reason}`);
    })
    .done();

  // start our animation chain right away
  deferred.resolve();
  return animationDone.promise;
};

GitVisuals.prototype.explodeNodes = function (speed) {
  const deferred = Q.defer();
  let funcs = [];
  for (const visNode of Object.values(this.visNodeMap)) {
    funcs.push(visNode.getExplodeStepFunc(speed));
  }

  var interval = setInterval(() => {
    // object creation here is a bit ugly inside a loop,
    // but the alternative is to just OR against a bunch
    // of booleans which means the other stepFuncs
    // are called unnecessarily when they have almost
    // zero speed. would be interesting to see performance differences
    const keepGoing = [];
    for (const func of funcs) {
      if (func()) {
        keepGoing.push(func);
      }
    }

    if (keepGoing.length === 0) {
      clearInterval(interval);
      // next step :D wow I love promises
      deferred.resolve();
      return;
    }

    funcs = keepGoing;
  }, 1 / 40);

  return deferred.promise;
};

GitVisuals.prototype.animateAllFromAttrToAttr = function (fromSnapshot, toSnapshot, idsToOmit) {
  const animate = function (object) {
    const id = object.getID();
    if (idsToOmit.includes(id)) {
      return;
    }

    if (!fromSnapshot[id] || !toSnapshot[id]) {
      // its actually ok it doesn't exist yet
      return;
    }
    object.animateFromAttrToAttr(fromSnapshot[id], toSnapshot[id]);
  };

  this.visBranchCollection.each(animate);
  this.visEdgeCollection.each(animate);
  this.visTagCollection.each(animate);
  Object.values(this.visNodeMap).forEach(animate);
};

/** *************************************
     == BEGIN Tree Calculation Parts ==
       _  __    __  _
       \\/ /    \ \//_
        \ \     /   __|   __
         \ \___/   /_____/ /
          |        _______ \
          \  ( )   /      \_\
           \      /
            |    |
            |    |
  ____+-_=+-^    ^+-=_=__________

^^ I drew that :D

 ************************************* */

GitVisuals.prototype.genSnapshot = function () {
  this.fullCalc();

  const snapshot = {};
  Object.values(this.visNodeMap).forEach((visNode) => {
    snapshot[visNode.get('id')] = visNode.getAttributes();
  }, this);

  this.visBranchCollection.each((visBranch) => {
    snapshot[visBranch.getID()] = visBranch.getAttributes();
  }, this);

  this.visEdgeCollection.each((visEdge) => {
    snapshot[visEdge.getID()] = visEdge.getAttributes();
  }, this);

  this.visTagCollection.each((visTag) => {
    snapshot[visTag.getID()] = visTag.getAttributes();
  }, this);

  return snapshot;
};

GitVisuals.prototype.refreshTree = function (speed) {
  if (!this.gitReady || !this.gitEngine.rootCommit) {
    return;
  }

  // this method can only be called after graphics are rendered
  this.fullCalc();

  this.animateAll(speed);
};

GitVisuals.prototype.refreshTreeHarsh = function () {
  this.fullCalc();

  this.animateAll(0);
};

GitVisuals.prototype.animateAll = function (speed) {
  this.zIndexReflow();

  this.animateEdges(speed);
  this.animateNodePositions(speed);
  this.animateRefs(speed);
};

GitVisuals.prototype.fullCalc = function () {
  this.calcTreeCoords();
  this.calcGraphicsCoords();
};

GitVisuals.prototype.calcTreeCoords = function () {
  // this method can only contain things that don't rely on graphics
  if (!this.rootCommit) {
    throw new Error('grr, no root commit!');
  }

  this.calcUpstreamSets();
  this.calcBranchStacks();
  this.calcTagStacks();

  this.calcDepth();
  this.calcWidth();
};

GitVisuals.prototype.calcGraphicsCoords = function () {
  this.visBranchCollection.each((visBranch) => {
    visBranch.updateName();
  });
  this.visTagCollection.each((visTag) => {
    visTag.updateName();
  });
};

GitVisuals.prototype.calcUpstreamSets = function () {
  this.upstreamBranchSet = this.gitEngine.getUpstreamBranchSet();
  this.upstreamHeadSet = this.gitEngine.getUpstreamHeadSet();
  this.upstreamTagSet = this.gitEngine.getUpstreamTagSet();
};

GitVisuals.prototype.getCommitUpstreamBranches = function (commit) {
  return this.branchStackMap[commit.get('id')];
};

GitVisuals.prototype.getBlendedHuesForCommit = function (commit) {
  const branches = this.upstreamBranchSet[commit.get('id')];
  if (!branches) {
    throw new Error('that commit doesn\'t have upstream branches!');
  }

  return this.blendHuesFromBranchStack(branches);
};

GitVisuals.prototype.blendHuesFromBranchStack = function (branchStackArray) {
  const hueStrings = [];
  for (const branchWrapper of branchStackArray) {
    let fill = branchWrapper.obj.get('visBranch').get('fill');

    if (fill.slice(0, 3) !== 'hsb') {
      // crap! convert
      const color = Raphael.color(fill);
      fill = `hsb(${String(color.h)},${String(color.l)}`;
      fill = `${fill},${String(color.s)})`;
    }

    hueStrings.push(fill);
  }

  return blendHueStrings(hueStrings);
};

GitVisuals.prototype.getCommitUpstreamStatus = function (commit) {
  if (!this.upstreamBranchSet) {
    throw new Error("Can't calculate this yet!");
  }

  const id = commit.get('id');
  const branch = this.upstreamBranchSet;
  const head = this.upstreamHeadSet;
  const tag = this.upstreamTagSet;

  if (branch[id]) {
    return 'branch';
  } if (tag[id]) {
    return 'tag';
  } if (head[id]) {
    return 'head';
  }
  return 'none';
};

GitVisuals.prototype.calcTagStacks = function () {
  const tags = this.gitEngine.getTags();
  const map = {};
  for (const tag of tags) {
    const thisId = tag.target.get('id');

    map[thisId] = map[thisId] || [];
    map[thisId].push(tag);
    map[thisId].sort((a, b) => {
      const aId = a.obj.get('id');
      const bId = b.obj.get('id');
      return aId.localeCompare(bId);
    });
  }
  this.tagStackMap = map;
};

GitVisuals.prototype.calcBranchStacks = function () {
  const branches = this.gitEngine.getBranches();
  const map = {};
  for (const branch of branches) {
    const thisId = branch.target.get('id');

    map[thisId] = map[thisId] || [];
    map[thisId].push(branch);
    map[thisId].sort((a, b) => {
      const aId = a.obj.get('id');
      const bId = b.obj.get('id');
      if (aId == 'master' || bId == 'master') {
        return aId == 'master' ? -1 : 1;
      }
      return aId.localeCompare(bId);
    });
  }
  this.branchStackMap = map;
};

GitVisuals.prototype.calcWidth = function () {
  this.maxWidthRecursive(this.rootCommit);

  const bounds = this.getPosBoundaries();
  this.assignBoundsRecursive(
    this.rootCommit,
    bounds.min,
    bounds.max,
  );
};

GitVisuals.prototype.maxWidthRecursive = function (commit) {
  let childrenTotalWidth = 0;
  commit.get('children').forEach(function (child) {
    // only include this if we are the "main" parent of
    // this child
    if (child.isMainParent(commit)) {
      const childWidth = this.maxWidthRecursive(child);
      childrenTotalWidth += childWidth;
    }
  }, this);

  const maxWidth = Math.max(1, childrenTotalWidth);
  commit.get('visNode').set('maxWidth', maxWidth);
  return maxWidth;
};

GitVisuals.prototype.assignBoundsRecursive = function (commit, min, max) {
  // I always position myself within my bounds
  const myWidthPos = (max + min) / 2;
  commit.get('visNode').get('pos').x = myWidthPos;

  if (commit.get('children').length === 0) {
    return;
  }

  // i have a certain length to divide up
  const myLength = max - min;
  // I will divide up that length based on my children's max width in a
  // basic box-flex model
  let totalFlex = 0;
  const children = commit.get('children');
  children.forEach((child) => {
    if (child.isMainParent(commit)) {
      totalFlex += child.get('visNode').getMaxWidthScaled();
    }
  }, this);

  let previousBound = min;
  children.forEach(function (child, index) {
    if (!child.isMainParent(commit)) {
      return;
    }

    const flex = child.get('visNode').getMaxWidthScaled();
    const portion = (flex / totalFlex) * myLength;

    const childMin = previousBound;
    const childMax = childMin + portion;

    this.assignBoundsRecursive(child, childMin, childMax);
    previousBound = childMin + portion;
  }, this);
};

GitVisuals.prototype.calcDepth = function () {
  const maxDepth = this.calcDepthRecursive(this.rootCommit, 0);
  if (maxDepth > 15) {
    // issue warning
    console.warn('graphics are degrading from too many layers');
  }

  const depthIncrement = this.getDepthIncrement(maxDepth);
  Object.values(this.visNodeMap).forEach(function (visNode) {
    visNode.setDepthBasedOn(depthIncrement, this.getHeaderOffset());
  }, this);
};

/** *************************************
     == END Tree Calculation ==
       _  __    __  _
       \\/ /    \ \//_
        \ \     /   __|   __
         \ \___/   /_____/ /
          |        _______ \
          \  ( )   /      \_\
           \      /
            |    |
            |    |
  ____+-_=+-^    ^+-=_=__________

^^ I drew that :D

 ************************************* */

GitVisuals.prototype.animateNodePositions = function (speed) {
  Object.values(this.visNodeMap).forEach((visNode) => {
    visNode.animateUpdatedPosition(speed);
  }, this);
};

GitVisuals.prototype.addBranchFromEvent = function (branch, collection, index) {
  const action = function () {
    this.addBranch(branch);
  }.bind(this);

  if (!this.gitEngine || !this.gitReady) {
    this.defer(action);
  } else {
    action();
  }
};

GitVisuals.prototype.addBranch = function (branch) {
  const visBranch = new VisBranch({
    branch,
    gitVisuals: this,
    gitEngine: this.gitEngine,
  });

  this.visBranchCollection.add(visBranch);
  if (this.gitReady) {
    visBranch.genGraphics(this.paper);
  } else {
    this.defer(() => {
      visBranch.genGraphics(this.paper);
    });
  }
};

GitVisuals.prototype.addTagFromEvent = function (tag, collection, index) {
  const action = function () {
    this.addTag(tag);
  }.bind(this);

  if (!this.gitEngine || !this.gitReady) {
    this.defer(action);
  } else {
    action();
  }
};

GitVisuals.prototype.removeTag = function (tag, collection, index) {
  const action = function () {
    let tagToRemove;
    this.visTagCollection.each((visTag) => {
      if (visTag.get('tag') == tag) {
        tagToRemove = visTag;
      }
    }, true);
    tagToRemove.remove();
    this.removeVisTag(tagToRemove);
  }.bind(this);

  if (!this.gitEngine || !this.gitReady) {
    this.defer(action);
  } else {
    action();
  }
};

GitVisuals.prototype.addTag = function (tag) {
  const visTag = new VisTag({
    tag,
    gitVisuals: this,
    gitEngine: this.gitEngine,
  });

  this.visTagCollection.add(visTag);
  if (this.gitReady) {
    visTag.genGraphics(this.paper);
  } else {
    this.defer(() => {
      visTag.genGraphics(this.paper);
    });
  }
};

GitVisuals.prototype.removeVisBranch = function (visBranch) {
  this.visBranchCollection.remove(visBranch);
};

GitVisuals.prototype.removeVisTag = function (visTag) {
  this.visTagCollection.remove(visTag);
};

GitVisuals.prototype.removeVisNode = function (visNode) {
  delete this.visNodeMap[visNode.getID()];
};

GitVisuals.prototype.removeVisEdge = function (visEdge) {
  this.visEdgeCollection.remove(visEdge);
};

GitVisuals.prototype.animateRefs = function (speed) {
  this.visBranchCollection.each((visBranch) => {
    visBranch.animateUpdatedPos(speed);
  }, this);
  this.visTagCollection.each((visTag) => {
    visTag.animateUpdatedPos(speed);
  }, this);
};

GitVisuals.prototype.animateEdges = function (speed) {
  this.visEdgeCollection.each((edge) => {
    edge.animateUpdatedPath(speed);
  }, this);
};

GitVisuals.prototype.getMinLayers = function () {
  return (this.options.smallCanvas) ? 2 : 7;
};

GitVisuals.prototype.getDepthIncrement = function (maxDepth) {
  // assume there are at least a number of layers until later
  // to have better visuals
  maxDepth = Math.max(maxDepth, this.getMinLayers());
  // if we have a header, reserve space for that
  const vSpace = 1 - this.getHeaderOffset();
  const increment = vSpace / maxDepth;
  return increment;
};

GitVisuals.prototype.shouldHaveHeader = function () {
  return this.gitEngine.isOrigin() || this.gitEngine.hasOrigin();
};

GitVisuals.prototype.getHeaderOffset = function () {
  return (this.shouldHaveHeader()) ? 0.05 : 0;
};

GitVisuals.prototype.calcDepthRecursive = function (commit, depth) {
  commit.get('visNode').setDepth(depth);

  const children = commit.get('children');
  let maxDepth = depth;
  children.forEach(function (child) {
    const d = this.calcDepthRecursive(child, depth + 1);
    maxDepth = Math.max(d, maxDepth);
  }, this);

  return maxDepth;
};

// we debounce here so we aren't firing a resize call on every resize event
// but only after they stop
GitVisuals.prototype.canvasResize = function (width, height) {
  if (!this.resizeFunc) {
    this.genResizeFunc();
  }
  this.resizeFunc(width, height);
};

GitVisuals.prototype.genResizeFunc = function () {
  this.resizeFunc = debounce(
    (width, height) => {
      this.refreshTree();
    },
    200,
    true,
  );
};

GitVisuals.prototype.addNode = function (id, commit) {
  this.commitMap[id] = commit;
  if (commit.get('rootCommit')) {
    this.rootCommit = commit;
  }

  const visNode = new VisNode({
    id,
    commit,
    gitVisuals: this,
    gitEngine: this.gitEngine,
  });
  this.visNodeMap[id] = visNode;

  if (this.gitReady) {
    visNode.genGraphics(this.paper);
  }
  return visNode;
};

GitVisuals.prototype.addEdge = function (idTail, idHead) {
  const visNodeTail = this.visNodeMap[idTail];
  const visNodeHead = this.visNodeMap[idHead];

  if (!visNodeTail || !visNodeHead) {
    throw new Error(`one of the ids in (${idTail
    }, ${idHead}) does not exist`);
  }

  const edge = new VisEdge({
    tail: visNodeTail,
    head: visNodeHead,
    gitVisuals: this,
    gitEngine: this.gitEngine,
  });
  this.visEdgeCollection.add(edge);

  if (this.gitReady) {
    edge.genGraphics(this.paper);
  }
};

GitVisuals.prototype.zIndexReflow = function () {
  this.visNodesFront();
  this.visBranchesFront();
  this.visTagsFront();
};

GitVisuals.prototype.visNodesFront = function () {
  for (const visNode of Object.values(this.visNodeMap)) {
    visNode.toFront();
  }
};

GitVisuals.prototype.visBranchesFront = function () {
  this.visBranchCollection.each((vBranch) => {
    vBranch.nonTextToFront();
    vBranch.textToFront();
  });

  this.visBranchCollection.each((vBranch) => {
    vBranch.textToFrontIfInStack();
  });
};

GitVisuals.prototype.visTagsFront = function () {
  this.visTagCollection.each((vTag) => {
    vTag.nonTextToFront();
    vTag.textToFront();
  });

  this.visTagCollection.each((vTag) => {
    vTag.textToFrontIfInStack();
  });
};

GitVisuals.prototype.drawTreeFromReload = function () {
  this.gitReady = true;
  // gen all the graphics we need
  this.deferFlush();

  this.calcTreeCoords();
};

GitVisuals.prototype.drawTreeFirstTime = function () {
  this.gitReady = true;
  this.calcTreeCoords();

  Object.values(this.visNodeMap).forEach(function (visNode) {
    visNode.genGraphics(this.paper);
  }, this);

  this.visEdgeCollection.each(function (edge) {
    edge.genGraphics(this.paper);
  }, this);

  this.visBranchCollection.each(function (visBranch) {
    visBranch.genGraphics(this.paper);
  }, this);

  this.visTagCollection.each(function (visTag) {
    visTag.genGraphics(this.paper);
  }, this);

  this.zIndexReflow();
};

/** **********************
 * Random util functions, some from liquidGraph
 ********************** */
function blendHueStrings(hueStrings) {
  // assumes a sat of 0.7 and brightness of 1

  let x = 0;
  let y = 0;
  let totalSat = 0;
  let totalBright = 0;
  const { length } = hueStrings;

  hueStrings.forEach((hueString) => {
    let exploded = hueString.split('(')[1];
    [exploded] = exploded.split(')');
    exploded = exploded.split(',');
    console.log(`${hueString} => ${exploded}`);

    totalSat += Number.parseFloat(exploded[1]);
    totalBright += Number.parseFloat(exploded[2]);
    const hue = Number.parseFloat(exploded[0]);

    const angle = hue * Math.PI * 2;
    x += Math.cos(angle);
    y += Math.sin(angle);
  });

  x /= length;
  y /= length;
  totalSat /= length;
  totalBright /= length;

  let hue = Math.atan2(y, x) / (Math.PI * 2); // could fail on 0's
  if (hue < 0) {
    hue += 1;
  }
  return `hsb(${String(hue)},${String(totalSat)},${String(totalBright)})`;
}

exports.GitVisuals = GitVisuals;
