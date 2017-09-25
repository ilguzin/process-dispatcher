/**
 * @file {@link ProcessDispatcher} is simply a container of pre-forked {@link ModuleProcess} instances.
 * It also a set of useful tools.
 * @author Denis Ilguzin
 */

import * as async from "async";

import {logger as defaultLogger, range} from "./utils";
import {ModuleProcess} from "./moduleProcess"

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
export class ProcessDispatcher {

  /**
   * <p>Callback to run on function finished. <i>Note: It might contain arbitrary number of arguments (required at
   * least one - error)</i></p>
   *
   * @callback ProcessDispatcher~onReadyCallback
   * @param error {Error}   An Error object if the callback has raised an error.
   */

  /**
   *
   * @param moduleName
   * @param moduleOpts
   * @param logger
   */
  constructor (moduleName, moduleOpts, logger = defaultLogger) {
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
  static makeModuleProcess (moduleName, moduleOpts, logger) {
    return (callback) => new ModuleProcess(moduleName, moduleOpts, logger).init(callback);
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
  static dispatchToModule (moduleName, moduleOpts, logger, functionName, params) {
    return (callback) => {
      async.waterfall([
        (callback) => {
          ProcessDispatcher.makeModuleProcess(moduleName, moduleOpts, logger)(callback);
        },
        (moduleProcess, callback) => {
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
  static dispatchToModuleProcess (moduleProcess, functionName, params) {
    return (callback) => moduleProcess.invoke(functionName, params)(callback);
  };

  /**
   * <p>Create listener to catch the IPC messages within the process the module is running in.</p>
   *
   * @deprecated  This is no longer a part of {@link ProcessDispatcher}. Migrated to
   * {@link ModuleProcess.listenIPCMessages}.
   */
  static listenIPCMessages (moduleFn, moduleFileName, logger) {
    ModuleProcess.listenIPCMessages(moduleFn, moduleFileName, logger);
  };

  /**
   * <p>Creates round robin ids for preforked subprocesses. See how {@link ProcessDispatcher.dispatch} works.</p>
   */
  updateRRId () {
    this._rrIds = range(this.availableProcesses.length);
  };

  /**
   * <p>Implementation of FIFO queue for selecting of pre-forked subprocess ids.</p>
   * <p>See how {@link ProcessDispatcher.dispatch} works in this regard.</p>
   *
   * @returns {Number} Number of sub-process ID.
   */
  getNextProcId () {
    let nextId = this._rrIds.shift();
    this._rrIds.push(nextId);
    return nextId;
  };

  /**
   * <p>Pre-fork subprocess and update a list of available sub-process ids.</p>
   *
   * @param num
   * @returns {ProcessDispatcher~onReadyCallback} On execution finished.
   */
  preFork (num) {
    this.logger.debug("preFork " + num);
    return (callback) => {
      async.series(
        range(num).map( () => {
          return (callback) => ProcessDispatcher.makeModuleProcess(this.moduleName, this.moduleOpts, this.logger)(callback);
        } )
      ,
        (error, moduleProcesses) => {
          this.logger.debug("preFork created " + moduleProcesses.length);
          if (!error && moduleProcesses) {
            this.availableProcesses = moduleProcesses;
            this.updateRRId();
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
   *
   * @param functionName  Function name to be called. The desired module wrapped by {@link ModuleProcess} should expose
   *                      API via {@link ProcessDispatcher.listenIPCMessages}. The functionName should be a part of that
   *                      API.
   * @param params        The parameters to be passed to the functionName
   * @returns {ProcessDispatcher~onReadyCallback} On execution finished.
   */
  dispatch (functionName, params) {
    //this.logger.debug("ProcessDispatcher.dispatch t: ", process.hrtime()[1]);

    let moduleProcess;

    let availableProcessNum = this.availableProcesses.length;

    if (availableProcessNum) {
      let processNumber = this.getNextProcId();

      this.logger.debug("Dispatching '" + functionName + "' to process number " + processNumber + ". Available processes number " + availableProcessNum);

      moduleProcess = this.availableProcesses[processNumber];
    }

    return (callback) => {
      async.waterfall([
        (callback) => {
          // Make a descicion on create new process or use existing one.
          if (moduleProcess) {
            this.logger.debug("Make use of existing process for '" + this.moduleName + "' invocation of '" + functionName + "'");
            callback(null, moduleProcess);
          } else {
            // let errorMessage = "No '" + this.moduleName + "' processes available yet for invocation of '" + functionName + "'";
            // this.logger.debug(errorMessage);
            // callback(new Error(errorMessage));
            this.logger.debug("Creating new process for '" + this.moduleName + "' invocation of '" + functionName + "'");
            ProcessDispatcher.makeModuleProcess(this.moduleName, this.moduleOpts, this.logger)(callback);
          }
        },
        (moduleProcess, callback) => {
          ProcessDispatcher.dispatchToModuleProcess(moduleProcess, functionName, params)(callback);
        }
      ], callback);
    };
  };

}






