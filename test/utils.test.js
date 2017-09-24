import 'chai/register-should';

import {range, logger, isFunction} from '../src/utils';

describe("Test library utils", () => {
  it("should get an arbitrary range", () => {
    let generatedRange = range(5);
    generatedRange.should.be.an('array');
    generatedRange.should.be.deep.equal([0, 1, 2, 3, 4]);
  });

  it("should test if the subject is a function", () => {
    isFunction(function () {}).should.be.equal(true);
  });

  it("should return proper logger", () => {
    logger.should.be.instanceOf(Proxy);
  });
});
