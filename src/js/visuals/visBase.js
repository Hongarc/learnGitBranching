const Backbone = require('backbone');

const VisBase = Backbone.Model.extend({
  removeKeys(keys) {
    keys.forEach(function (key) {
      if (this.get(key)) {
        this.get(key).remove();
      }
    }, this);
  },

  getNonAnimateKeys() {
    return [
      'stroke-dasharray',
    ];
  },

  getIsInOrigin() {
    if (!this.get('gitEngine')) {
      return false;
    }
    return this.get('gitEngine').isOrigin();
  },

  animateToAttr(attribute, speed, easing) {
    if (speed === 0) {
      this.setAttr(attribute, /* instant */ true);
      return;
    }

    const s = speed !== undefined ? speed : this.get('animationSpeed');
    const e = easing || this.get('animationEasing');
    this.setAttr(attribute, /* instance */ false, s, e);
  },

  setAttrBase(keys, attribute, instant, speed, easing) {
    keys.forEach(function (key) {
      if (instant) {
        this.get(key).attr(attribute[key]);
      } else {
        this.get(key).stop();
        this.get(key).animate(attribute[key], speed, easing);
        // some keys don't support animating too, so set those instantly here
        this.getNonAnimateKeys().forEach(function (nonAnimateKey) {
          if (attribute[key] && attribute[key][nonAnimateKey] !== undefined) {
            this.get(key).attr(nonAnimateKey, attribute[key][nonAnimateKey]);
          }
        }, this);
      }

      if (attribute.css) {
        $(this.get(key).node).css(attribute.css);
      }
    }, this);
  },

  animateAttrKeys(keys, attributeObject, speed, easing) {
    // either we animate a specific subset of keys or all
    // possible things we could animate
    keys = {

      include: ['circle', 'arrow', 'rect', 'path', 'text'],
      exclude: [],
      ...keys || {},
    };

    const attribute = this.getAttributes();

    // safely insert this attribute into all the keys we want
    for (const key of keys.include) {
      attribute[key] = {

        ...attribute[key],
        ...attributeObject,
      };
    }

    for (const key of keys.exclude) {
      delete attribute[key];
    }

    this.animateToAttr(attribute, speed, easing);
  },
});

exports.VisBase = VisBase;
