
module.exports = {
  makeMuteLogger: function () {
    var logger = {};
    ['info', 'debug', 'warn', 'error'].forEach(function(logLevel) { logger[logLevel] = function() { }; });
    return logger;
  },
  makeConsoleLogger: function () {
    var logger = {};
    ['info', 'debug', 'warn', 'error'].forEach(function(logLevel) { logger[logLevel] = console.log; });
    return logger;
  }
};
