const Backbone = require('backbone');
const { GRAPHICS } = require('../util/constants');

const { VisBase } = require('./visBase');
const TreeCompare = require('../graph/treeCompare');

const randomHueString = function () {
  const hue = Math.random();
  const string = `hsb(${String(hue)},0.6,1)`;
  return string;
};

const VisBranch = VisBase.extend({
  defaults: {
    pos: null,
    text: null,
    rect: null,
    arrow: null,
    isHead: false,
    flip: 1,

    fill: GRAPHICS.rectFill,
    stroke: GRAPHICS.rectStroke,
    'stroke-width': GRAPHICS.rectStrokeWidth,

    offsetX: GRAPHICS.nodeRadius * 4.75,
    offsetY: 0,
    arrowHeight: 14,
    arrowInnerSkew: 0,
    arrowEdgeHeight: 6,
    arrowLength: 14,
    arrowOffsetFromCircleX: 10,

    vPad: 5,
    hPad: 5,

    animationSpeed: GRAPHICS.defaultAnimationTime,
    animationEasing: GRAPHICS.defaultEasing,
  },

  validateAtInit() {
    if (!this.get('branch')) {
      throw new Error('need a branch!');
    }
  },

  getID() {
    return this.get('branch').get('id');
  },

  initialize() {
    this.validateAtInit();

    // shorthand notation for the main objects
    this.gitVisuals = this.get('gitVisuals');
    this.gitEngine = this.get('gitEngine');
    if (!this.gitEngine) {
      throw new Error('asd wtf');
    }

    this.get('branch').set('visBranch', this);
    const id = this.get('branch').get('id');

    if (id == 'HEAD') {
      // switch to a head ref
      this.set('isHead', true);
      this.set('flip', -1);
      this.refreshOffset();

      this.set('fill', GRAPHICS.headRectFill);
    } else if (id !== 'master') {
      // we need to set our color to something random
      this.set('fill', randomHueString());
    }
  },

  getCommitPosition() {
    const commit = this.gitEngine.getCommitFromRef(this.get('branch'));
    const visNode = commit.get('visNode');

    this.set('flip', this.getFlipValue(commit, visNode));
    this.refreshOffset();
    return visNode.getScreenCoords();
  },

  getDashArray() {
    if (!this.get('gitVisuals').getIsGoalVis()) {
      return '';
    }
    return (this.getIsLevelBranchCompared()) ? '' : '--';
  },

  getIsGoalAndNotCompared() {
    if (!this.get('gitVisuals').getIsGoalVis()) {
      return false;
    }

    return !this.getIsLevelBranchCompared();
  },

  /**
   * returns true if we are a branch that is not being
   * compared in the goal (used in a goal visualization context
   */
  getIsLevelBranchCompared() {
    if (this.getIsMaster()) {
      return true; // master always compared
    }
    // we are not master, so return true if its not just master being compared
    const levelBlob = this.get('gitVisuals').getLevelBlob();
    return !TreeCompare.onlyMasterCompared(levelBlob);
  },

  getIsMaster() {
    return this.get('branch').get('id') == 'master';
  },

  getFlipValue(commit, visNode) {
    const threshold = this.get('gitVisuals').getFlipPos();
    const overThreshold = (visNode.get('pos').x > threshold);

    // easy logic first
    if (commit.get('id') === 'C0') {
      return -1;
    }
    if (!this.get('isHead')) {
      return (overThreshold) ? -1 : 1;
    }

    // now for HEAD....
    if (overThreshold) {
      // if by ourselves, then feel free to squeeze in. but
      // if other branches are here, then we need to show separate
      return (this.isBranchStackEmpty()) ? -1 : 1;
    }
    return (this.isBranchStackEmpty()) ? 1 : -1;
  },

  refreshOffset() {
    const baseOffsetX = GRAPHICS.nodeRadius * 4.75;
    const offsetY = 33;
    const deltaX = 10;
    if (this.get('flip') === 1) {
      this.set('offsetY', -offsetY);
      this.set('offsetX', baseOffsetX - deltaX);
    } else {
      this.set('offsetY', offsetY);
      this.set('offsetX', baseOffsetX - deltaX);
    }
  },

  getArrowTransform() {
    if (this.get('flip') === 1) {
      return 't-2,-20R-35';
    }
    return 't2,20R-35';
  },

  getBranchStackIndex() {
    if (this.get('isHead')) {
      // head is never stacked with other branches
      return 0;
    }

    const myArray = this.getBranchStackArray();
    let index = -1;
    myArray.forEach(function (branch, index_) {
      if (branch.obj == this.get('branch')) {
        index = index_;
      }
    }, this);
    return index;
  },

  getBranchStackLength() {
    if (this.get('isHead')) {
      // head is always by itself
      return 1;
    }

    return this.getBranchStackArray().length;
  },

  isBranchStackEmpty() {
    // useful function for head when computing flip logic
    const array = this.gitVisuals.branchStackMap[this.getCommitID()];
    return (array)
      ? array.length === 0
      : true;
  },

  getCommitID() {
    let target = this.get('branch').get('target');
    if (target.get('type') === 'branch') {
      // for HEAD
      target = target.get('target');
    }
    return target.get('id');
  },

  getBranchStackArray() {
    const array = this.gitVisuals.branchStackMap[this.getCommitID()];
    if (array === undefined) {
      // this only occurs when we are generating graphics inside of
      // a new Branch instantiation, so we need to force the update
      this.gitVisuals.calcBranchStacks();
      return this.getBranchStackArray();
    }
    return array;
  },

  getTextPosition() {
    const pos = this.getCommitPosition();

    // then order yourself accordingly. we use alphabetical sorting
    // so everything is independent
    const myPos = this.getBranchStackIndex();
    return {
      x: pos.x + this.get('flip') * this.get('offsetX'),
      y: pos.y + myPos * GRAPHICS.multiBranchY + this.get('offsetY'),
    };
  },

  getRectPosition() {
    const pos = this.getTextPosition();
    const f = this.get('flip');

    // first get text width and height
    const textSize = this.getTextSize();
    return {
      x: pos.x - 0.5 * textSize.w - this.get('hPad'),
      y: pos.y - 0.5 * textSize.h - this.get('vPad'),
    };
  },

  getArrowPath() {
    // should make these util functions...
    const offset2d = function (pos, x, y) {
      return {
        x: pos.x + x,
        y: pos.y + y,
      };
    };
    const toStringCoords = function (pos) {
      return `${String(Math.round(pos.x))},${String(Math.round(pos.y))}`;
    };
    const f = this.get('flip');

    const arrowTip = offset2d(this.getCommitPosition(),
      f * this.get('arrowOffsetFromCircleX'),
      0);
    const arrowEdgeUp = offset2d(arrowTip, f * this.get('arrowLength'), -this.get('arrowHeight'));
    const arrowEdgeLow = offset2d(arrowTip, f * this.get('arrowLength'), this.get('arrowHeight'));

    const arrowInnerUp = offset2d(arrowEdgeUp,
      f * this.get('arrowInnerSkew'),
      this.get('arrowEdgeHeight'));
    const arrowInnerLow = offset2d(arrowEdgeLow,
      f * this.get('arrowInnerSkew'),
      -this.get('arrowEdgeHeight'));

    const tailLength = 49;
    const arrowStartUp = offset2d(arrowInnerUp, f * tailLength, 0);
    const arrowStartLow = offset2d(arrowInnerLow, f * tailLength, 0);

    let pathString = '';
    pathString += `M${toStringCoords(arrowStartUp)} `;
    const coords = [
      arrowInnerUp,
      arrowEdgeUp,
      arrowTip,
      arrowEdgeLow,
      arrowInnerLow,
      arrowStartLow,
    ];
    coords.forEach((pos) => {
      pathString += `L${toStringCoords(pos)} `;
    }, this);
    pathString += 'z';
    return pathString;
  },

  getTextSize() {
    const getTextWidth = function (visBranch) {
      const textNode = (visBranch.get('text')) ? visBranch.get('text').node : null;
      return (textNode === null) ? 0 : textNode.getBoundingClientRect().width;
    };

    const firefoxFix = function (object) {
      if (!object.w) { object.w = 75; }
      if (!object.h) { object.h = 20; }
      return object;
    };

    const textNode = this.get('text').node;
    if (this.get('isHead')) {
      // HEAD is a special case
      const size = textNode.getBoundingClientRect();
      return firefoxFix({
        w: size.width,
        h: size.height,
      });
    }

    let maxWidth = 0;
    for (const branch of this.getBranchStackArray()) {
      maxWidth = Math.max(maxWidth, getTextWidth(
        branch.obj.get('visBranch'),
      ));
    }

    return firefoxFix({
      w: maxWidth,
      h: textNode.clientHeight,
    });
  },

  getSingleRectSize() {
    const textSize = this.getTextSize();
    const vPad = this.get('vPad');
    const hPad = this.get('hPad');
    return {
      w: textSize.w + vPad * 2,
      h: textSize.h + hPad * 2,
    };
  },

  getRectSize() {
    const textSize = this.getTextSize();
    // enforce padding
    const vPad = this.get('vPad');
    const hPad = this.get('hPad');

    // number of other branch names we are housing
    const totalNumber = this.getBranchStackLength();
    return {
      w: textSize.w + vPad * 2,
      h: textSize.h * totalNumber * 1.1 + hPad * 2,
    };
  },

  getIsRemote() {
    return this.get('branch').getIsRemote();
  },

  getName() {
    let name = this.get('branch').getName();
    const selected = this.get('branch') === this.gitEngine.HEAD.get('target');
    const isRemote = this.getIsRemote();
    const isHg = this.gitEngine.getIsHg();

    if (name === 'HEAD' && isHg) {
      name = '.';
    }
    if (/\bmaster\b/.test(name)) {
      name = name.replace(/\bmaster\b/, 'main');
    }

    const after = (selected && !this.getIsInOrigin() && !isRemote) ? '*' : '';
    return name + after;
  },

  nonTextToFront() {
    this.get('arrow').toFront();
    this.get('rect').toFront();
  },

  textToFront() {
    this.get('text').toFront();
  },

  textToFrontIfInStack() {
    if (this.getBranchStackIndex() !== 0) {
      this.get('text').toFront();
    }
  },

  getFill() {
    // in the easy case, just return your own fill if you are:
    // - the HEAD ref
    // - by yourself (length of 1)
    // - part of a multi branch, but your thing is hidden
    if (this.get('isHead')
        || this.getBranchStackLength() == 1
        || this.getBranchStackIndex() !== 0) {
      return this.get('fill');
    }

    // woof. now it's hard, we need to blend hues...
    return this.gitVisuals.blendHuesFromBranchStack(this.getBranchStackArray());
  },

  remove() {
    this.removeKeys(['text', 'arrow', 'rect']);
    // also need to remove from this.gitVisuals
    this.gitVisuals.removeVisBranch(this);
  },

  handleModeChange() {},

  genGraphics(paper) {
    const textPos = this.getTextPosition();
    const name = this.getName();

    // when from a reload, we don't need to generate the text
    const text = paper.text(textPos.x, textPos.y, String(name));
    text.attr({
      'font-size': 14,
      'font-family': "Menlo, Monaco, Consolas, 'Droid Sans Mono', monospace",
      opacity: this.getTextOpacity(),
    });
    this.set('text', text);
    const attribute = this.getAttributes();

    const rectPos = this.getRectPosition();
    const sizeOfRect = this.getRectSize();
    const rect = paper
      .rect(rectPos.x, rectPos.y, sizeOfRect.w, sizeOfRect.h, 8)
      .attr(attribute.rect);
    this.set('rect', rect);

    const arrowPath = this.getArrowPath();
    const arrow = paper
      .path(arrowPath)
      .attr(attribute.arrow);
    this.set('arrow', arrow);

    // set CSS
    const keys = ['text', 'rect', 'arrow'];
    keys.forEach(function (key) {
      $(this.get(key).node).css(attribute.css);
    }, this);

    this.attachClickHandlers();
    rect.toFront();
    text.toFront();
  },

  attachClickHandlers() {
    if (this.get('gitVisuals').options.noClick) {
      return;
    }
    const objs = [
      this.get('rect'),
      this.get('text'),
      this.get('arrow'),
    ];

    objs.forEach(function (rObject) {
      rObject.click(this.onClick.bind(this));
    }, this);
  },

  shouldDisableClick() {
    return this.get('isHead') && !this.gitEngine.getDetachedHead();
  },

  onClick() {
    if (this.shouldDisableClick()) {
      return;
    }

    const commandString = `git checkout ${this.get('branch').get('id')}`;
    const Main = require('../app');
    Main.getEventBaton().trigger('commandSubmitted', commandString);
  },

  updateName() {
    this.get('text').attr({
      text: this.getName(),
    });
  },

  getNonTextOpacity() {
    if (this.get('isHead')) {
      return this.gitEngine.getDetachedHead() ? 1 : 0;
    }
    if (this.getBranchStackIndex() !== 0) {
      return 0;
    }

    return 1;
  },

  getTextOpacity() {
    if (this.get('isHead')) {
      return this.gitEngine.getDetachedHead() ? 1 : 0;
    }

    if (this.getIsGoalAndNotCompared()) {
      return (this.getBranchStackIndex() === 0) ? 0.7 : 0.3;
    }

    return 1;
  },

  getStrokeWidth() {
    if (this.getIsGoalAndNotCompared()) {
      return this.get('stroke-width') / 5;
    }

    return this.get('stroke-width');
  },

  getAttributes() {
    const textOpacity = this.getTextOpacity();
    this.updateName();

    const textPos = this.getTextPosition();
    const rectPos = this.getRectPosition();
    const rectSize = this.getRectSize();

    const arrowPath = this.getArrowPath();
    const dashArray = this.getDashArray();
    const cursorStyle = (this.shouldDisableClick())
      ? 'auto'
      : 'pointer';

    return {
      css: {
        cursor: cursorStyle,
      },
      text: {
        x: textPos.x,
        y: textPos.y,
        opacity: textOpacity,
      },
      rect: {
        x: rectPos.x,
        y: rectPos.y,
        width: rectSize.w,
        height: rectSize.h,
        opacity: this.getNonTextOpacity(),
        fill: this.getFill(),
        stroke: this.get('stroke'),
        'stroke-dasharray': dashArray,
        'stroke-width': this.getStrokeWidth(),
      },
      arrow: {
        path: arrowPath,
        opacity: this.getNonTextOpacity(),
        fill: this.getFill(),
        stroke: this.get('stroke'),
        transform: this.getArrowTransform(),
        'stroke-dasharray': dashArray,
        'stroke-width': this.getStrokeWidth(),
      },
    };
  },

  animateUpdatedPos(speed, easing) {
    const attribute = this.getAttributes();
    this.animateToAttr(attribute, speed, easing);
  },

  animateFromAttrToAttr(fromAttribute, toAttribute, speed, easing) {
    // an animation of 0 is essentially setting the attribute directly
    this.animateToAttr(fromAttribute, 0);
    this.animateToAttr(toAttribute, speed, easing);
  },

  setAttr(attribute, instant, speed, easing) {
    const keys = ['text', 'rect', 'arrow'];
    this.setAttrBase(keys, attribute, instant, speed, easing);
  },
});

const VisBranchCollection = Backbone.Collection.extend({
  model: VisBranch,
});

exports.VisBranchCollection = VisBranchCollection;
exports.VisBranch = VisBranch;
exports.randomHueString = randomHueString;
