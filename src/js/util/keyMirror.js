/**
 * Our own flavor of keyMirror since I get some weird
 * obscure error when trying to import the react lib one.
 */
const keyMirror = function (object) {
  const result = {};
  for (const key in object) {
    if (!object.hasOwnProperty(key)) {
      continue;
    }
    result[key] = key;
  }
  return result;
};

module.exports = keyMirror;
