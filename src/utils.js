var _ = require('underscore');


function makeLoggingFn(logLevel) {
  return function () {
    var loggingString = _.reduce(arguments, function(arg, memo) { return arg + memo; }, "");
    console.log("[" + (new Date()).toISOString() + " " + logLevel.toUpperCase() + " : " + loggingString);
  };
}

var logger = {};
['info', 'debug', 'warn', 'error'].forEach(function(logLevel) { logger[logLevel] = makeLoggingFn(logLevel); });

/**
 *
 * @param size
 * @returns {Array}
 */
var range = function(size) {
  var tmp = [];
  for (var i = 0; i < size; i++) { tmp.push(i); }
  return tmp;
};

function isFunction(x) {
  return typeof x === 'function';
}

module.exports = {
  logger: logger,
  range: range,
  isFunction: isFunction
};
