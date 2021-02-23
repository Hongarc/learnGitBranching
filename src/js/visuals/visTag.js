const Backbone = require('backbone');
const { GRAPHICS } = require('../util/constants');

const { VisBase } = require('./visBase');
const TreeCompare = require('../graph/treeCompare');

const randomHueString = function () {
  const hue = Math.random();
  const string = `hsb(${String(hue)},0.7,1)`;
  return string;
};

const VisTag = VisBase.extend({
  defaults: {
    pos: null,
    text: null,
    rect: null,
    isHead: false,

    fill: GRAPHICS.tagFill,
    stroke: GRAPHICS.tagStroke,
    'stroke-width': GRAPHICS.tagStrokeWidth,

    offsetX: GRAPHICS.nodeRadius,
    offsetY: GRAPHICS.nodeRadius,

    vPad: 2,
    hPad: 2,

    animationSpeed: GRAPHICS.defaultAnimationTime,
    animationEasing: GRAPHICS.defaultEasing,
  },

  validateAtInit() {
    if (!this.get('tag')) {
      throw new Error('need a Tag!');
    }
  },

  getID() {
    return this.get('tag').get('id');
  },

  initialize() {
    this.validateAtInit();

    // shorthand notation for the main objects
    this.gitVisuals = this.get('gitVisuals');
    this.gitEngine = this.get('gitEngine');
    if (!this.gitEngine) {
      throw new Error('asd wtf');
    }

    this.get('tag').set('visTag', this);
  },

  getCommitPosition() {
    const commit = this.gitEngine.getCommitFromRef(this.get('tag'));
    const visNode = commit.get('visNode');

    return visNode.getScreenCoords();
  },

  getDashArray() {
    if (!this.get('gitVisuals').getIsGoalVis()) {
      return '';
    }
    return (this.getIsLevelTagCompared()) ? '' : '--';
  },

  getIsGoalAndNotCompared() {
    if (!this.get('gitVisuals').getIsGoalVis()) {
      return false;
    }

    return !this.getIsLevelTagCompared();
  },

  /**
   * returns true if we are a Tag that is not being
   * compared in the goal (used in a goal visualization context
   */
  getIsLevelTagCompared() {
    // we are not master, so return true if its not just master being compared
    const levelBlob = this.get('gitVisuals').getLevelBlob();
    return !TreeCompare.onlyMasterCompared(levelBlob);
  },

  getTagStackIndex() {
    if (this.get('isHead')) {
      // head is never stacked with other Tags
      return 0;
    }

    const myArray = this.getTagStackArray();
    let index = -1;
    myArray.forEach(function (Tag, index_) {
      if (Tag.obj === this.get('tag')) {
        index = index_;
      }
    }, this);
    return index;
  },

  getTagStackLength() {
    if (this.get('isHead')) {
      // head is always by itself
      return 1;
    }

    return this.getTagStackArray().length;
  },

  isTagStackEmpty() {
    // useful function for head when computing flip logic
    const array = this.gitVisuals.tagStackMap[this.getCommitID()];
    return (array)
      ? array.length === 0
      : true;
  },

  getCommitID() {
    const target = this.get('tag').get('target');
    return target.get('id');
  },

  getTagStackArray() {
    const array = this.gitVisuals.tagStackMap[this.getCommitID()];
    if (array === undefined) {
      // this only occurs when we are generating graphics inside of
      // a new Tag instantiation, so we need to force the update
      this.gitVisuals.calcTagStacks();
      return this.getTagStackArray();
    }
    return array;
  },

  getTextPosition() {
    const pos = this.getCommitPosition();

    // then order yourself accordingly. we use alphabetical sorting
    // so everything is independent
    const myPos = this.getTagStackIndex();

    return {
      x: pos.x + this.get('offsetX'),
      y: pos.y + myPos * GRAPHICS.multiTagY + this.get('offsetY'),
    };
  },

  getRectPosition() {
    const pos = this.getTextPosition();

    // first get text width and height
    const textSize = this.getTextSize();
    return {
      x: pos.x - this.get('hPad'),
      y: pos.y - 0.5 * textSize.h - this.get('vPad'),
    };
  },

  getTextSize() {
    const getTextWidth = function (visTag) {
      const textNode = (visTag.get('text')) ? visTag.get('text').node : null;
      return (textNode === null) ? 0 : textNode.getBoundingClientRect().width;
    };

    const firefoxFix = function (object) {
      if (!object.w) { object.w = 75; }
      if (!object.h) { object.h = 20; }
      return object;
    };

    const textNode = this.get('text').node;

    let maxWidth = 0;
    for (const Tag of this.getTagStackArray()) {
      maxWidth = Math.max(maxWidth, getTextWidth(
        Tag.obj.get('visTag'),
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

    // number of other Tag names we are housing
    const totalNumber = this.getTagStackLength();
    return {
      w: textSize.w + vPad * 2,
      h: textSize.h * totalNumber + hPad * 2,
    };
  },

  getIsRemote() {
    return this.get('tag').getIsRemote();
  },

  getName() {
    const name = this.get('tag').getName();
    const isRemote = this.getIsRemote();
    const isHg = this.gitEngine.getIsHg();

    return name;
  },

  nonTextToFront() {
    this.get('rect').toFront();
  },

  textToFront() {
    this.get('text').toFront();
  },

  textToFrontIfInStack() {
    if (this.getTagStackIndex() !== 0) {
      this.get('text').toFront();
    }
  },

  remove() {
    this.removeKeys(['text', 'rect']);
    // also need to remove from this.gitVisuals
    this.gitVisuals.removeVisTag(this);
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
      'text-anchor': 'start',
    });
    this.set('text', text);
    const attribute = this.getAttributes();

    const rectPos = this.getRectPosition();
    const sizeOfRect = this.getRectSize();
    const rect = paper
      .rect(rectPos.x, rectPos.y, sizeOfRect.w, sizeOfRect.h, 8)
      .attr(attribute.rect);
    this.set('rect', rect);

    // set CSS
    const keys = ['text', 'rect'];
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

    const commandString = `git checkout ${this.get('tag').get('id')}`;
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
    if (this.getTagStackIndex() !== 0) {
      return 0;
    }

    return 1;
  },

  getTextOpacity() {
    if (this.get('isHead')) {
      return this.gitEngine.getDetachedHead() ? 1 : 0;
    }

    if (this.getIsGoalAndNotCompared()) {
      return (this.getTagStackIndex() === 0) ? 0.7 : 0.3;
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
        fill: this.get('fill'),
        stroke: this.get('stroke'),
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
    const keys = ['text', 'rect'];
    this.setAttrBase(keys, attribute, instant, speed, easing);
  },
});

const VisTagCollection = Backbone.Collection.extend({
  model: VisTag,
});

exports.VisTagCollection = VisTagCollection;
exports.VisTag = VisTag;
exports.randomHueString = randomHueString;
