
export function makeMuteLogger () {
  return new Proxy({}, {
    get: (target, logLevel, receiver) => {
      return (loggingString) => {}
    }
  });
}
