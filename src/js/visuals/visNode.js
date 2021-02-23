const Backbone = require('backbone');
const { GRAPHICS } = require('../util/constants');

const { VisBase } = require('./visBase');

const VisNode = VisBase.extend({
  defaults: {
    depth: undefined,
    maxWidth: null,
    outgoingEdges: null,

    circle: null,
    text: null,

    id: null,
    pos: null,
    radius: null,

    commit: null,
    animationSpeed: GRAPHICS.defaultAnimationTime,
    animationEasing: GRAPHICS.defaultEasing,

    fill: GRAPHICS.defaultNodeFill,
    'stroke-width': GRAPHICS.defaultNodeStrokeWidth,
    stroke: GRAPHICS.defaultNodeStroke,
  },

  getID() {
    return this.get('id');
  },

  validateAtInit() {
    if (!this.get('id')) {
      throw new Error('need id for mapping');
    }
    if (!this.get('commit')) {
      throw new Error('need commit for linking');
    }

    if (!this.get('pos')) {
      this.set('pos', {
        x: Math.random(),
        y: Math.random(),
      });
    }
  },

  initialize() {
    this.validateAtInit();
    // shorthand for the main objects
    this.gitVisuals = this.get('gitVisuals');
    this.gitEngine = this.get('gitEngine');

    this.set('outgoingEdges', []);
  },

  setDepth(depth) {
    // for merge commits we need to max the depths across all
    this.set('depth', Math.max(this.get('depth') || 0, depth));
  },

  setDepthBasedOn(depthIncrement, offset) {
    if (this.get('depth') === undefined) {
      throw new Error('no depth yet!');
    }
    const pos = this.get('pos');
    pos.y = this.get('depth') * depthIncrement + offset;
  },

  getMaxWidthScaled() {
    // returns our max width scaled based on if we are visible
    // from a branch or not
    const stat = this.gitVisuals.getCommitUpstreamStatus(this.get('commit'));
    const map = {
      branch: 1,
      tag: 1,
      head: 0.3,
      none: 0.1,
    };
    if (map[stat] === undefined) { throw new Error('bad stat'); }
    return map[stat] * this.get('maxWidth');
  },

  toFront() {
    this.get('circle').toFront();
    this.get('text').toFront();
  },

  getOpacity() {
    const map = {
      branch: 1,
      tag: 1,
      head: GRAPHICS.upstreamHeadOpacity,
      none: GRAPHICS.upstreamNoneOpacity,
    };

    const stat = this.gitVisuals.getCommitUpstreamStatus(this.get('commit'));
    if (map[stat] === undefined) {
      throw new Error('invalid status');
    }
    return map[stat];
  },

  getTextScreenCoords() {
    return this.getScreenCoords();
  },

  getAttributes() {
    const pos = this.getScreenCoords();
    const textPos = this.getTextScreenCoords();
    const opacity = this.getOpacity();
    const dashArray = (this.getIsInOrigin())
      ? GRAPHICS.originDash : '';

    return {
      circle: {
        cx: pos.x,
        cy: pos.y,
        opacity,
        r: this.getRadius(),
        fill: this.getFill(),
        'stroke-width': this.get('stroke-width'),
        'stroke-dasharray': dashArray,
        stroke: this.get('stroke'),
      },
      text: {
        x: textPos.x,
        y: textPos.y,
        opacity,
      },
    };
  },

  animatePositionTo(visNode, speed, easing) {
    const attributes = this.getAttributes();
    const destinationAttributes = visNode.getAttributes();

    // TODO make not hardcoded
    attributes.circle = destinationAttributes.circle;
    attributes.text = destinationAttributes.text;
    this.animateToAttr(attributes, speed, easing);
  },

  highlightTo(visObject, speed, easing) {
    // a small function to highlight the color of a node for demonstration purposes
    const color = visObject.get('fill');

    const attribute = {
      circle: {
        fill: color,
        stroke: color,
        'stroke-dasharray': '',
        'stroke-width': this.get('stroke-width') * 5,
      },
      text: {},
    };

    this.animateToAttr(attribute, speed, easing);
  },

  animateUpdatedPosition(speed, easing) {
    const attribute = this.getAttributes();
    this.animateToAttr(attribute, speed, easing);
  },

  animateFromAttrToAttr(fromAttribute, toAttribute, speed, easing) {
    // an animation of 0 is essentially setting the attribute directly
    this.animateToAttr(fromAttribute, 0);
    this.animateToAttr(toAttribute, speed, easing);
  },

  animateToSnapshot(snapShot, speed, easing) {
    if (!snapShot[this.getID()]) {
      return;
    }
    this.animateToAttr(snapShot[this.getID()], speed, easing);
  },

  setAttr(attribute, instant, speed, easing) {
    const keys = ['text', 'circle'];
    this.setAttrBase(keys, attribute, instant, speed, easing);
  },

  animateToAttr(attribute, speed, easing) {
    Reflect.apply(VisBase.prototype.animateToAttr, this, arguments);
    const s = speed !== undefined ? speed : this.get('animationSpeed');
    const e = easing || this.get('animationEasing');

    if (easing == 'bounce'
        && attribute.circle && attribute.circle.cx !== undefined
        && attribute.text && attribute.text.x !== undefined) {
      // animate the x attribute without bouncing so it looks like there's
      // gravity in only one direction. Just a small animation polish
      this.get('circle').animate(attribute.circle.cx, s, 'easeInOut');
      this.get('text').animate(attribute.text.x, s, 'easeInOut');
    }
  },

  getScreenCoords() {
    const pos = this.get('pos');
    return this.gitVisuals.toScreenCoords(pos);
  },

  getRadius() {
    return this.get('radius') || GRAPHICS.nodeRadius;
  },

  getParentScreenCoords() {
    return this.get('commit').get('parents')[0].get('visNode').getScreenCoords();
  },

  setBirthPosition() {
    // utility method for animating it out from underneath a parent
    const parentCoords = this.getParentScreenCoords();

    this.get('circle').attr({
      cx: parentCoords.x,
      cy: parentCoords.y,
      opacity: 0,
      r: 0,
    });
    this.get('text').attr({
      x: parentCoords.x,
      y: parentCoords.y,
      opacity: 0,
    });
  },

  setBirthFromSnapshot(beforeSnapshot) {
    // first get parent attribute
    // woof this is pretty bad data access...
    const parentID = this.get('commit').get('parents')[0].get('visNode').getID();
    const parentAttribute = beforeSnapshot[parentID];

    // then set myself faded on top of parent
    this.get('circle').attr({
      opacity: 0,
      r: 0,
      cx: parentAttribute.circle.cx,
      cy: parentAttribute.circle.cy,
    });

    this.get('text').attr({
      opacity: 0,
      x: parentAttribute.text.x,
      y: parentAttribute.text.y,
    });

    // then do edges
    const parentCoords = {
      x: parentAttribute.circle.cx,
      y: parentAttribute.circle.cy,
    };
    this.setOutgoingEdgesBirthPosition(parentCoords);
  },

  setBirth() {
    this.setBirthPosition();
    this.setOutgoingEdgesBirthPosition(this.getParentScreenCoords());
  },

  setOutgoingEdgesOpacity(opacity) {
    for (const edge of this.get('outgoingEdges')) {
      edge.setOpacity(opacity);
    }
  },

  animateOutgoingEdgesToAttr(snapShot, speed, easing) {
    this.get('outgoingEdges').forEach((edge) => {
      const attribute = snapShot[edge.getID()];
      edge.animateToAttr(attribute);
    }, this);
  },

  animateOutgoingEdges(speed, easing) {
    this.get('outgoingEdges').forEach((edge) => {
      edge.animateUpdatedPath(speed, easing);
    }, this);
  },

  animateOutgoingEdgesFromSnapshot(snapshot, speed, easing) {
    this.get('outgoingEdges').forEach((edge) => {
      const attribute = snapshot[edge.getID()];
      edge.animateToAttr(attribute, speed, easing);
    }, this);
  },

  setOutgoingEdgesBirthPosition(parentCoords) {
    this.get('outgoingEdges').forEach((edge) => {
      const headPos = edge.get('head').getScreenCoords();
      const path = edge.genSmoothBezierPathStringFromCoords(parentCoords, headPos);
      edge.get('path').stop();
      edge.get('path').attr({
        path,
        opacity: 0,
      });
    }, this);
  },

  parentInFront() {
    // woof! talk about bad data access
    this.get('commit').get('parents')[0].get('visNode').toFront();
  },

  getFontSize(string) {
    if (string.length < 3) {
      return 12;
    } if (string.length < 5) {
      return 10;
    }
    return 8;
  },

  getFill() {
    // first get our status, might be easy from this
    const stat = this.gitVisuals.getCommitUpstreamStatus(this.get('commit'));
    if (stat == 'head') {
      return GRAPHICS.headRectFill;
    } if (stat == 'tag') {
      return GRAPHICS.orphanNodeFill;
    } if (stat == 'none') {
      return GRAPHICS.orphanNodeFill;
    }

    // now we need to get branch hues
    return this.gitVisuals.getBlendedHuesForCommit(this.get('commit'));
  },

  attachClickHandlers() {
    if (this.get('gitVisuals').options.noClick) {
      return;
    }
    const commandString = `git checkout ${this.get('commit').get('id')}`;
    const Main = require('../app');
    for (const rObject of [this.get('circle'), this.get('text')]) {
      rObject.click(() => {
        Main.getEventBaton().trigger('commandSubmitted', commandString);
      });
      $(rObject.node).css('cursor', 'pointer');
    }
  },

  setOpacity(opacity) {
    opacity = (opacity === undefined) ? 1 : opacity;

    // set the opacity on my stuff
    const keys = ['circle', 'text'];
    keys.forEach(function (key) {
      this.get(key).attr({
        opacity,
      });
    }, this);
  },

  remove() {
    this.removeKeys(['circle'], ['text']);
    // needs a manual removal of text for whatever reason
    const text = this.get('text');
    if (text) {
      text.remove();
    }

    this.gitVisuals.removeVisNode(this);
  },

  removeAll() {
    this.remove();
    this.removeAllEdges();
  },

  removeAllEdges() {
    this.get('outgoingEdges').forEach((edge) => {
      edge.remove();
    }, this);
  },

  getExplodeStepFunc(speed) {
    if (!speed) {
      throw new Error('need speed by now');
    }
    const circle = this.get('circle');

    // decide on a speed
    const speedMag = 20 / speed;
    // aim upwards
    const angle = Math.PI + Math.random() * 1 * Math.PI;
    const gravity = (1 / 5) * speed;
    const drag = (1 / 100) * speed;

    let vx = speedMag * Math.cos(angle);
    let vy = speedMag * Math.sin(angle);
    let x = circle.attr('cx');
    let y = circle.attr('cy');

    const maxWidth = this.gitVisuals.paper.width;
    const maxHeight = this.gitVisuals.paper.height;
    const elasticity = 0.8 / speed;
    const dt = 1;

    const stepFunction = function () {
      // lol epic runge kutta here... not
      vy += gravity * dt - drag * vy;
      vx -= drag * vx;
      x += vx * dt;
      y += vy * dt;

      if (x < 0 || x > maxWidth) {
        vx = elasticity * -vx;
        x = (x < 0) ? 0 : maxWidth;
      }
      if (y < 0 || y > maxHeight) {
        vy = elasticity * -vy;
        y = (y < 0) ? 0 : maxHeight;
      }

      circle.attr({
        cx: x,
        cy: y,
      });
      // continuation calculation
      if ((vx * vx + vy * vy) < 0.1 && Math.abs(y - maxHeight) <= 0.1) {
        // don't need to animate anymore, we are on ground
        return false;
      }
      // keep animating!
      return true;
    };
    return stepFunction;
  },

  makeCircle(paper) {
    const pos = this.getScreenCoords();
    return paper.circle(
      pos.x,
      pos.y,
      this.getRadius(),
    ).attr(this.getAttributes().circle);
  },

  makeText(paper) {
    const textPos = this.getTextScreenCoords();
    return paper.text(textPos.x, textPos.y, String(this.get('id')));
  },

  genGraphics() {
    const { paper } = this.gitVisuals;
    const circle = this.makeCircle(paper);
    const text = this.makeText(paper);

    text.attr({
      'font-size': this.getFontSize(this.get('id')),
      'font-weight': 'bold',
      'font-family': "Menlo, Monaco, Consolas, 'Droid Sans Mono', monospace",
      opacity: this.getOpacity(),
    });

    this.set('circle', circle);
    this.set('text', text);

    this.attachClickHandlers();
  },
});

exports.VisNode = VisNode;
