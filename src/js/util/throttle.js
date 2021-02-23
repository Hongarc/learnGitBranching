module.exports = function (function_, time) {
  let wait = false;
  return function () {
    if (!wait) {
      Reflect.apply(function_, this, arguments);
      wait = true;

      setTimeout(() => {
        wait = false;
      }, time);
    }
  };
};
