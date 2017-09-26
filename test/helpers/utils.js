
export function makeMuteLogger () {
  let logger = {};
  ['info', 'debug', 'warn', 'error'].forEach(function(logLevel) { logger[logLevel] = function() {}; });
  return logger;
}
