module.exports = function (function_, time, immediate) {
  let timeout;
  return function () {
    const later = function () {
      timeout = null;
      if (!immediate) {
        Reflect.apply(function_, this, arguments);
      }
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, time);
    if (callNow) {
      Reflect.apply(function_, this, arguments);
    }
  };
};
