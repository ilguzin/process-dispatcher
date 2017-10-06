
module.exports = {
  makeMuteLogger: function () {
    var logger = {};
    ['info', 'debug', 'warn', 'error'].forEach(function(logLevel) { logger[logLevel] = function() { }; });
    return logger;
  }
};
