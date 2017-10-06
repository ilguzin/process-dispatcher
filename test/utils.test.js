var chai = require('chai');
chai.should();

var utils = require('../src/utils'), range = utils.range, logger = utils.logger, isFunction = utils.isFunction;

describe("Test library utils", function () {
  it("should get an arbitrary range", function () {
    var generatedRange = range(5);
    generatedRange.should.be.an('array');
    generatedRange.should.be.deep.equal([0, 1, 2, 3, 4]);
  });

  it("should test if the subject is a function", function () {
    isFunction(function () {}).should.be.equal(true);
  });

});
