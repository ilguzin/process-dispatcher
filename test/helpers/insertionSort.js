import ProcessDispatcher from '../../src/index';

import {makeMuteLogger} from './utils';

/**
 * This has been taken from https://github.com/benoitvallon/computer-science-in-javascript.git
 */
function insertionSort(params) {
  let array = params.array;
  for(let i = 0; i < array.length; i++) {
    let temp = array[i];
    let j = i - 1;
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
ProcessDispatcher.listenIPCMessages(function () {

  /** {@link moduleOpts} Might be used later */

  return {
    insertionSort: function (params) {

      let result = insertionSort(params);

      return function (callback) {
        callback(null, result);
      }

    }
  }

}, __filename, makeMuteLogger());

