const Backbone = require('backbone');

const VisBase = Backbone.Model.extend({
  removeKeys(keys) {
    keys.forEach(function (key) {
      if (this.get(key)) {
        this.get(key).remove();
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
