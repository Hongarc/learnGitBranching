exports.mock = function (Constructor) {
  const dummy = {};
  const stub = function () {};

  for (const key in Constructor.prototype) {
    dummy[key] = stub;
  }
  return dummy;
};
