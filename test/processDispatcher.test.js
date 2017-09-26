import 'chai/register-should';

import {ProcessDispatcher} from '../src/index';
import {makeMuteLogger} from './helpers/utils';

describe("Test ProcessDispatcher class functionality", function () {
  this.timeout(5000); // Defined custom suite-level timeout

  it("should create and run ProcessDispatcher", (done) => {

    let pd = new ProcessDispatcher(__dirname + '/helpers/insertionSort.js', {}, makeMuteLogger());

    const TEST_ARRAY = [2, 4, 6, 8, 1, 3, 5, 7, 9];
    const TEST_ARRAY_RESULT = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    pd.preFork(1)(function (error) {
      if (!error) {
        pd.dispatch('insertionSort', {array: TEST_ARRAY})(function (error, result) {
          result.should.be.deep.equal(TEST_ARRAY_RESULT);
          done();
        })
      }
    });

  });

  it("should create and run ProcessDispatcher no pre-fork", (done) => {

    let pd = new ProcessDispatcher(__dirname + '/helpers/insertionSort.js', {}, makeMuteLogger());

    const TEST_ARRAY = [2, 4, 6, 8, 1, 3, 5, 7, 9];
    const TEST_ARRAY_RESULT = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    pd.dispatch('insertionSort', {array: TEST_ARRAY})(function (error, result) {
      result.should.be.deep.equal(TEST_ARRAY_RESULT);
      done();
    });

  });

});
