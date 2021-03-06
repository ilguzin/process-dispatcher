/**
 * @file {@link ProcessDispatcher} is simply a container of pre-forked {@link ModuleProcess} instances.
 * It also a set of useful tools.
 * @author Denis Ilguzin
 */

var async = require("async");

var utils = require("./utils"), defaultLogger = utils.logger, range = utils.range;
var ModuleProcess = require ("./moduleProcess");

/**
 * <p>Callback to run on function finished. <i>Note: It might contain arbitrary number of arguments (required at
 * least one - error)</i></p>
 *
 * @callback ProcessDispatcher~onReadyCallback
 * @param error {Error}   An Error object if the callback has raised an error.
 */

/**
 * <p><i><strong>Note: before running dispatching workflow do not forget to init listener on the module.</strong>
 * For that purpose, please invoke {@link ModuleProcess.listenIPCMessages} in the module root. It will engage module
 * to listen to IPC messages and expose module API available via sub-processing.</i></p>
 *
 * @param moduleName {string}   Module name (script file name). E.g. __filename
 * @param moduleOpts {Object}   Options object to pass to the module
 * @param logger {Object}
 * @class
 */
function ProcessDispatcher (moduleName, moduleOpts, logger) {

  if (logger === undefined) { logger = defaultLogger; }

  this.moduleName = moduleName;
  this.moduleOpts = moduleOpts;
  this.availableProcesses = [];
  this.logger = logger;
}

/**
 * <p>Create a module sub-process and configure its listener to accepts messages.</p>
 *
 * @param moduleName
 * @param moduleOpts
 * @param logger
 * @returns {ProcessDispatcher~onReadyCallback}
 */
ProcessDispatcher.makeModuleProcess = function (moduleName, moduleOpts, logger) {
  return function (callback) { new ModuleProcess(moduleName, moduleOpts, logger).init(callback); };
};

/**
 * <p>Dispatch function invocation to existing moduleProcess.</p>
 *
 * @param moduleName {string}     A js filename containing module function (!) (e.g. module.exports = function() { }).
 *                                I.e. module that is defined by function.
 * @param moduleOpts {Object}     Will be passed to module-function to create a module instance.
 * @param logger
 * @param functionName {string}   Function to be invoked (should be defined on the module).
 * @param params {Object}         Parameters mapping.
 * @returns {ProcessDispatcher~onReadyCallback} On execution finished.
 */
ProcessDispatcher.dispatchToModule = function(moduleName, moduleOpts, logger, functionName, params) {
  return function (callback) {
    async.waterfall([
      function (callback) {
        ProcessDispatcher.makeModuleProcess(moduleName, moduleOpts, logger)(callback);
      },
      function (moduleProcess, callback) {
        ProcessDispatcher.dispatchToModuleProcess(moduleProcess, functionName, params)(callback);
      }
    ], callback);
  };
};

/**
 * <p>Dispatch function invocation to existing moduleProcess.</p>
 *
 * @param moduleProcess
 * @param functionName {string}   Function defined on the module.
 * @param params {Object}         Parameters mapping.
 * @returns {ProcessDispatcher~onReadyCallback} On execution finished.
 */
ProcessDispatcher.dispatchToModuleProcess = function (moduleProcess, functionName, params) {
  return function (callback) { moduleProcess.invoke(functionName, params)(callback); };
};

/**
 * <p>Create listener to catch the IPC messages within the process the module is running in.</p>
 *
 * @deprecated  This is no longer a part of {@link ProcessDispatcher}. Migrated to
 * {@link ModuleProcess.listenIPCMessages}.
 */
ProcessDispatcher.listenIPCMessages = function (moduleFn, moduleFileName, logger) {
  ModuleProcess.listenIPCMessages(moduleFn, moduleFileName, logger);
};

/**
 * <p>Creates round robin ids for preforked subprocesses. See how {@link ProcessDispatcher.dispatch} works.</p>
 */
ProcessDispatcher.prototype.updateRRId = function () {
  this._rrIds = range(this.availableProcesses.length);
};

/**
 * <p>Implementation of FIFO queue for selecting of pre-forked subprocess ids.</p>
 * <p>See how {@link ProcessDispatcher.dispatch} works in this regard.</p>
 *
 * @returns {Number} Number of sub-process ID.
 */
ProcessDispatcher.prototype.getNextProcId = function () {
  var nextId = this._rrIds.shift();
  this._rrIds.push(nextId);
  return nextId;
};

/**
 * <p>Pre-fork subprocess and update a list of available sub-process ids.</p>
 *
 * @param num
 * @returns {ProcessDispatcher~onReadyCallback} On execution finished.
 */
ProcessDispatcher.prototype.preFork = function (num) {
  var _this = this;
  _this.logger.debug("preFork " + num);
  return function (callback) {
    async.series(
      range(num).map( function () {
        return ProcessDispatcher.makeModuleProcess(_this.moduleName, _this.moduleOpts, _this.logger);
      } ),
      function (error, moduleProcesses) {
        _this.logger.debug("preFork created " + moduleProcesses.length);
        if (!error && moduleProcesses) {
          _this.availableProcesses = moduleProcesses;
          _this.updateRRId();
          callback();
        } else {
          callback(error);
        }
      }
    );
  };
};

/**
 * <p>Dispatch arbitrary function call to available {@link ModuleProcess} instance.</p>
 * <p>The {@link ModuleProcess} selection algorithm is round robin based. See {@link getNextProcId} in this regard.</p>
 * <p>In case if there are no pre-forked processes available to dispatch the function call to then create one and
 * add (if opts.termOnComplete is false) to available processes queue.</p>
 *
 * @param functionName  Function name to be called. The desired module wrapped by {@link ModuleProcess} should expose
 *                      API via {@link ProcessDispatcher.listenIPCMessages}. The functionName should be a part of that
 *                      API.
 * @param params        The parameters to be passed to the functionName
 * @param opts          Dispatch options.
 *                      termOnComplete - note: only applicable when no pre-forked sub-processes available
 *                      If True then stop {@link ModuleProcess} on dispatching completed otherwise add to internal
 *                      queue for future invocation speedup. Default: false.
 * @returns {ProcessDispatcher~onReadyCallback} On execution finished.
 */
ProcessDispatcher.prototype.dispatch = function (functionName, params, opts) {
  //this.logger.debug("ProcessDispatcher.dispatch t: ", process.hrtime()[1]);

  if (!opts) {
    opts = {
      termOnComplete: false
    };
  }

  var _this = this;

  var existingModuleProcess;

  var availableProcessNum = this.availableProcesses.length;

  if (availableProcessNum) {
    var processNumber = _this.getNextProcId();

    _this.logger.debug("Dispatching '" + functionName + "' to process number " + processNumber + ". Available processes number " + availableProcessNum);

    existingModuleProcess = _this.availableProcesses[processNumber];
  }

  return function (callback) {
    async.waterfall([
      function (callback) {
        // Make a decision on create new process or use existing one.
        if (existingModuleProcess) {
          _this.logger.debug("Make use of existing process for '" + _this.moduleName + "' module to invoke '" + functionName + "'");
          callback(null, existingModuleProcess);
        } else {
          _this.logger.debug("Create new process for '" + _this.moduleName + "' module to invoke '" + functionName + "'");
          ProcessDispatcher.makeModuleProcess(_this.moduleName, _this.moduleOpts, _this.logger)(callback);
        }
      },
      function (moduleProcess, callback) {
        async.waterfall([
          function (callback) {
            ProcessDispatcher.dispatchToModuleProcess(moduleProcess, functionName, params)(callback);
          },
          function (dispatchedResult, callback) {
            if (!existingModuleProcess) {
              if (opts.termOnComplete) {
                moduleProcess.stop(true)(function (error) { callback(error, dispatchedResult); });
              } else {
                _this.availableProcesses.push(moduleProcess);
                _this.updateRRId();
                callback(null, dispatchedResult);
              }
            } else {
              callback(null, dispatchedResult);
            }
          }
        ], callback);
      }
    ], callback);
  };
};

/**
 * Stop all {@link ModuleProcess} instances.
 *
 * @param force {boolean}   Ignore {@link ModuleProcess} "stop" errors.
 * @returns {Function}      Invoke callback on completed
 */
ProcessDispatcher.prototype.stop = function(force) {
  var _this = this;

  return function (callback) {

    async.series(_this.availableProcesses.map(function(mp) {
      return mp.stop(force);
    }), function(error) {
      _this.availableProcesses = _this.availableProcesses.filter(function(mp) { return !mp._stopped; });
      callback(error);
    });
  };

};

module.exports = ProcessDispatcher;
