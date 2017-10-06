var ModuleProcess = require('../../src/index').ModuleProcess;

var makeMuteLogger = require('./utils').makeMuteLogger;

/**
 * This has been taken from https://github.com/benoitvallon/computer-science-in-javascript.git
 */
function insertionSort(params) {
  var array = params.array;
  for(var i = 0; i < array.length; i++) {
    var temp = array[i];
    var j = i - 1;
    while (j >= 0 && array[j] > temp) {
      array[j + 1] = array[j];
      j--;
    }
    array[j + 1] = temp;
  }
  return array;
}

/**
 * Expose end-point to module desired parts via sub-processing
 */
ModuleProcess.listenIPCMessages(function () {

  /** {@link moduleOpts} Might be used later */

  return {
    insertionSort: function (params) {

      var result = insertionSort(params);

      return function (callback) {
        callback(null, result);
      };

    }
  };

}, __filename, makeMuteLogger());

