/**
 *
 * @type {Proxy}
 */
/*
export let logger = new Proxy({}, {
  get: (target, logLevel, receiver) => {
    if (logLevel in {}) { return {}[logLevel]; }
    // return (loggingString) => console.log(`[${new Date()} ${logLevel.toUpperCase()}] : ${loggingString}`);
    return (loggingString) => console.log(`[${new Date()}] : ${loggingString}`);
  }
});
*/

function makeLoggingFn(logLevel) {
  return (...args) => {
    let loggingString = args.reduceRight((arg, memo) => { return arg + memo }, "");
    console.log(`[${new Date()} ${logLevel.toUpperCase()}] : ${loggingString}`);
  }
}

export let logger = {};
['info', 'debug', 'warn', 'error'].forEach(function(logLevel) { logger[logLevel] = makeLoggingFn(logLevel); });

/**
 *
 * @param size
 * @returns {Array}
 */
export let range = (size) => {
  let tmp = [];
  for (let i = 0; i < size; i++) { tmp.push(i); }
  return tmp;
};

export function isFunction(x) {
  return typeof x === 'function';
}
