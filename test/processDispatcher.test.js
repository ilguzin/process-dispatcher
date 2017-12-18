var chai = require('chai');
chai.should();

var ProcessDispatcher = require('../src/index').ProcessDispatcher;
var makeMuteLogger = require('./helpers/utils').makeMuteLogger;

describe("Test ProcessDispatcher class functionality", function () {
  this.timeout(5000); // Defined custom suite-level timeout

  it("should create and run ProcessDispatcher", function (done) {

    var pd = new ProcessDispatcher(__dirname + '/helpers/insertionSort.js', {}, makeMuteLogger());

    var TEST_ARRAY = [2, 4, 6, 8, 1, 3, 5, 7, 9];
    var TEST_ARRAY_RESULT = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    pd.preFork(1)(function (error) {
      if (!error) {
        pd.dispatch('insertionSort', {array: TEST_ARRAY})(function (error, result) {
          result.should.be.deep.equal(TEST_ARRAY_RESULT);
          done();
        });
      }
    });

  });

  it("should create and run ProcessDispatcher no pre-fork", function (done) {

    var pd = new ProcessDispatcher(__dirname + '/helpers/insertionSort.js', {}, makeMuteLogger());

    var TEST_ARRAY = [2, 4, 6, 8, 1, 3, 5, 7, 9];
    var TEST_ARRAY_RESULT = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    pd.dispatch('insertionSort', {array: TEST_ARRAY})(function (error, result) {
      result.should.be.deep.equal(TEST_ARRAY_RESULT);
      done();
    });

  });

  it("should create and run ProcessDispatcher no pre-fork and then auto-terminate sub-process", function (done) {

    var pd = new ProcessDispatcher(__dirname + '/helpers/insertionSort.js', {}, makeMuteLogger());

    var TEST_ARRAY = [2, 4, 6, 8, 1, 3, 5, 7, 9];
    var TEST_ARRAY_RESULT = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    pd.dispatch('insertionSort', {array: TEST_ARRAY}, {termOnComplete: true})(function (error, result) {
      setTimeout(function() {
        pd.availableProcesses.length.should.be.equal(0);
        done();
      }, 100);
    });

  });

  it("should create and run ProcessDispatcher no pre-fork and then force terminate sub-process", function (done) {

    var pd = new ProcessDispatcher(__dirname + '/helpers/insertionSort.js', {}, makeMuteLogger());

    var TEST_ARRAY = [2, 4, 6, 8, 1, 3, 5, 7, 9];
    var TEST_ARRAY_RESULT = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    pd.dispatch('insertionSort', {array: TEST_ARRAY}, {termOnComplete: false})(function (error, result) {
      setTimeout(function() {
        pd.availableProcesses.length.should.be.equal(1);

        pd.stop(true)(function(error) {
          setTimeout(function() {
            pd.availableProcesses.length.should.be.equal(0);
            done();
          }, 100);
        });
      }, 100);
    });

  });

});
