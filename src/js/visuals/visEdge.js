const Backbone = require('backbone');
const { GRAPHICS } = require('../util/constants');

const { VisBase } = require('./visBase');
const GlobalStateStore = require('../stores/GlobalStateStore');

const VisEdge = VisBase.extend({
  defaults: {
    tail: null,
    head: null,
    animationSpeed: GRAPHICS.defaultAnimationTime,
    animationEasing: GRAPHICS.defaultEasing,
  },

  validateAtInit() {
    const required = ['tail', 'head'];
    required.forEach(function (key) {
      if (!this.get(key)) {
        throw new Error(`${key} is required!`);
      }
    }, this);
  },

  getID() {
    return `${this.get('tail').get('id')}.${this.get('head').get('id')}`;
  },

  initialize() {
    this.validateAtInit();

    // shorthand for the main objects
    this.gitVisuals = this.get('gitVisuals');
    this.gitEngine = this.get('gitEngine');

    this.get('tail').get('outgoingEdges').push(this);
  },

  remove() {
    this.removeKeys(['path']);
    this.gitVisuals.removeVisEdge(this);
  },

  genSmoothBezierPathString(tail, head) {
    const tailPos = tail.getScreenCoords();
    const headPos = head.getScreenCoords();
    return this.genSmoothBezierPathStringFromCoords(tailPos, headPos);
  },

  genSmoothBezierPathStringFromCoords(tailPos, headPos) {
    // we need to generate the path and control points for the bezier. format
    // is M(move abs) C (curve to) (control point 1) (control point 2) (final point)
    // the control points have to be __below__ to get the curve starting off straight.

    const flipFactor = (GlobalStateStore.getFlipTreeY()) ? -1 : 1;
    const coords = function (pos) {
      return `${String(Math.round(pos.x))},${String(Math.round(pos.y))}`;
    };
    const offset = function (pos, dir, delta) {
      delta = delta || GRAPHICS.curveControlPointOffset;
      return {
        x: pos.x,
        y: pos.y + flipFactor * delta * dir,
      };
    };
    const offset2d = function (pos, x, y) {
      return {
        x: pos.x + x,
        y: pos.y + flipFactor * y,
      };
    };

    // first offset tail and head by radii
    tailPos = offset(tailPos, -1, this.get('tail').getRadius());
    headPos = offset(headPos, 1, this.get('head').getRadius() * 1.15);

    let string = '';
    // first move to bottom of tail
    string += `M${coords(tailPos)} `;
    // start bezier
    string += 'C';
    // then control points above tail and below head
    string += `${coords(offset(tailPos, -1))} `;
    string += `${coords(offset(headPos, 1))} `;
    // now finish
    string += coords(headPos);

    // arrow head
    const delta = GRAPHICS.arrowHeadSize || 10;
    string += ` L${coords(offset2d(headPos, -delta, delta))}`;
    string += ` L${coords(offset2d(headPos, delta, delta))}`;
    string += ` L${coords(headPos)}`;

    // then go back, so we can fill correctly
    string += 'C';
    string += `${coords(offset(headPos, 1))} `;
    string += `${coords(offset(tailPos, -1))} `;
    string += coords(tailPos);

    return string;
  },

  getBezierCurve() {
    return this.genSmoothBezierPathString(this.get('tail'), this.get('head'));
  },

  getStrokeColor() {
    return GRAPHICS.visBranchStrokeColorNone;
  },

  setOpacity(opacity) {
    opacity = (opacity === undefined) ? 1 : opacity;

    this.get('path').attr({ opacity });
  },

  genGraphics(paper) {
    const pathString = this.getBezierCurve();

    const path = paper.path(pathString).attr({
      'stroke-width': GRAPHICS.visBranchStrokeWidth,
      stroke: this.getStrokeColor(),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      fill: this.getStrokeColor(),
    });
    path.toBack();
    this.set('path', path);
  },

  getOpacity() {
    const stat = this.gitVisuals.getCommitUpstreamStatus(this.get('tail'));
    const map = {
      branch: 1,
      tag: 1,
      head: GRAPHICS.edgeUpstreamHeadOpacity,
      none: GRAPHICS.edgeUpstreamNoneOpacity,
    };

    if (map[stat] === undefined) { throw new Error('bad stat'); }
    return map[stat];
  },

  getAttributes() {
    const newPath = this.getBezierCurve();
    const opacity = this.getOpacity();
    return {
      path: {
        path: newPath,
        opacity,
      },
    };
  },

  animateUpdatedPath(speed, easing) {
    const attribute = this.getAttributes();
    this.animateToAttr(attribute, speed, easing);
  },

  animateFromAttrToAttr(fromAttribute, toAttribute, speed, easing) {
    // an animation of 0 is essentially setting the attribute directly
    this.animateToAttr(fromAttribute, 0);
    this.animateToAttr(toAttribute, speed, easing);
  },

  animateToAttr(attribute, speed, easing) {
    if (speed === 0) {
      this.get('path').attr(attribute.path);
      return;
    }

    this.get('path').toBack();
    this.get('path').stop();
    this.get('path').animate(
      attribute.path,
      speed !== undefined ? speed : this.get('animationSpeed'),
      easing || this.get('animationEasing'),
    );
  },
});

const VisEdgeCollection = Backbone.Collection.extend({
  model: VisEdge,
});

exports.VisEdgeCollection = VisEdgeCollection;
exports.VisEdge = VisEdge;
