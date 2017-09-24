/**
 *
 * @type {Proxy}
 */
// export let logger = console.log;
export let logger = new Proxy({}, {
  get: (target, logLevel, receiver) => {
    if (logLevel in {}) { return {}[logLevel]; }
    // return (loggingString) => console.log(`[${new Date()} ${logLevel.toUpperCase()}] : ${loggingString}`);
    return (loggingString) => console.log(`[${new Date()}] : ${loggingString}`);
  }
});

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
