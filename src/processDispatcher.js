
import * as async from "async";

import {COMMANDS} from "./const";
import {logger as defaultLogger, range} from "./utils";
import {ModuleProcess} from "./moduleProcess"

/**
 * ProcessDispatcher is simply a container of pre-forked {@link ModuleProcess} instances.
 * It also a set of useful tools.
 *
 * # Initialization and dispatching example.
 *
 * ## Module initialization
 *
 * Note: before running dispatching workflow do not forget to init listener on the module.
 * For that purpose, please invoke this in the module root. It will engage module to listen to IPC messages and
 * expose module API available via subprocessing.
 *
 * @example powercalc.js
 *
 *   let ipcMessagesDelegate = function(moduleOpts) {
 *
 *     // The following is only an example... In common case arbitrary code should follow next
 *
 *     moduleOpts = _.defaults({}, moduleOpts);
 *
 *     if (moduleOpts && moduleOpts.cfg && moduleOpts.cfg.logging) {
 *       logger.transports.console.level = moduleOpts.cfg.logging.logLevel;
 *     }
 *
 *     forcegc = moduleOpts.cfg && moduleOpts.cfg.forcegc;
 *
 *     // meas.init(moduleOpts);
 *
 *     function init(callback) {
 *       let dcimapp = require("./dcimapp");
 *       let app = null; // NOT an Express web context !
 *       dcimapp.initapp(app, moduleOpts.cfg, function (error, handle) {
 *         conn = handle.conn;
 *         callback(error);
 *       });
 *     }
 *
 *     return {
 *       init: init,
 *       updateSupplierMeas_ipc: function (params) {
 *         _updateSupplierMeas({
 *           siteId: params.siteId,
 *           supplierType: params.supplierType,
 *           supplierId: params.supplierId,
 *           startTimestamp: params.startTimestamp,
 *           endTimestamp: params.endTimestamp,
 *           allocNoAdjust: params.allocNoAdjust,
 *           conn: conn,
 *           callback: params.callback
 *         });
 *       }
 *     }
 *   };
 *
 *   require('./utils').ProcessDispatcher.listenIPCMessages(ipcMessagesDelegate, __filename);
 *
 *   function _updateSupplierMeas(params) {
 *     // Some arbitrary function...
 *     params.callback();
 *   }
 *
 *
 * ## ProcessDispatcher configuration
 *
 * @example dispatcher.js
 *
 *    let moduleName = __dirname + '/powercalc.js';
 *
 *    let modOpts = {
 *      cfg: {
 *        appenv: cfg.appenv,
 *        approot: __dirname + "/..",
 *        dbconn: cfg.dbconn,
 *        enabled: true,
 *        logging: {
 *           logLevel": "error"
 *        },
 *        forcegc: true,
 *        process: {
 *          execArgv: ["--expose-gc"]
 *        },
 *        preForkNum: 1  // Pre-fork 1 subprocess for moduleName
 *      }
 *    };
 *
 *    let moduleProcessDispatcher = new ProcessDispatcher(moduleName, modOpts);           // Step 1: initialize
 *
 *    async.series([
 *      function(callback) {
 *        moduleProcessDispatcher.preFork(modOpts.cfg.preForkNum)(callback);              // Step 2: prefork subprocesses
 *      },
 *      function(callback) {
 *        let params = {
 *          siteId: 3,
 *          supplierType: 'circuits',
 *          supplierId: 124,
 *          startTimestamp: "2016-06-20T22:00:00.000Z",
 *          endTimestamp: "2016-06-29T22:00:00.000Z",
 *          allocNoAdjust: true
 *        };
 *        moduleProcessDispatcher.dispatch('updateSupplierMeas_ipc', params)(callback);   // Step 3: invoke function
 *                                                                                        // on existing module. See
 *                                                                                        // previous example.
 *      }
 *    ], function(error, results) {
 *      // ... Done
 *    });
 *
 *
 * @example
 *
 *
 */

export class ProcessDispatcher {
  constructor (moduleName, moduleOpts, logger = defaultLogger) {
    this.moduleName = moduleName;
    this.moduleOpts = moduleOpts;
    this.availableProcesses = [];
    this.logger = logger;
  }

  /**
   * Creates round robin ids for preforked subprocesses. See how {@link ProcessDispatcher.dispatch} works.
   */
  updateRRId () {
    this._rrIds = range(this.availableProcesses.length);
  };

  /**
   * Implementation of FIFO queue for selecting of pre-forked subprocess ids.
   * @returns {Number} Number of subprocess ID.
   *
   * See how {@link ProcessDispatcher.dispatch} works in this regard.
   */
  getNextProcId () {
    let nextId = this._rrIds.shift();
    this._rrIds.push(nextId);
    return nextId;
  };

  /**
   * Pre-fork subprocess and update a list of available subprocess ids.
   *
   * @param num
   * @returns {Function}
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
   * Dispatch arbitrary function call to available {@link ModuleProcess} instance.
   * The {@link ModuleProcess} selection algorithm is round robin based. See {@link getNextProcId} in this regard.
   *
   * @param functionName  Function name to be called. The desired module wrapped by {@link ModuleProcess} should expose
   *                      API via {@link ProcessDispatcher.listenIPCMessages}. The functionName should be a part of that
   *                      API.
   * @param params        The parameters to be passed to the functionName
   * @returns {Function}  Nodejs native callback-style function with callback (function(error, result) {...}) parameter.
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

  /**
   * Create a module sub-process and configure its listener to accepts messages.
   *
   * @param moduleName
   * @param moduleOpts
   * @param logger
   * @returns {Function}
   */
  static makeModuleProcess (moduleName, moduleOpts, logger) {
    return (callback) => new ModuleProcess(moduleName, moduleOpts, logger).init(callback);
  };

  /**
   * Dispatch function invocation to existing moduleProcess.
   *
   * @param moduleName {String}     A js filename containing module function (!) (e.g. module.exports = function() { }).
   *                                I.e. module that is defined by function.
   * @param moduleOpts {Object}     Will be passed to module-function to create a module instance.
   * @param logger
   * @param functionName {String}   Function to be invoked (should be defined on the module).
   * @param params {Object}         Parameters mapping.
   * @returns {Function}            Returns function accepting callback to be invoked on execution finished.
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
   * Dispatch function invocation to existing moduleProcess.
   *
   * @param moduleProcess
   * @param functionName {String}   Function defined on the module.
   * @param params {Object}         Parameters mapping.
   * @returns {Function}            Returns function accepting callback to be invoked on execution finished.
   */
  static dispatchToModuleProcess (moduleProcess, functionName, params) {
    return (callback) => moduleProcess.invoke(functionName, params)(callback);
  };

  /**
   * Create listener to catch the IPC messages within the process the module is running in.
   *
   * Important: The module should be running within process otherwise registering listener makes no sence.
   * This will invoke process.on('message', function() {}) to listen for parent process commands.
   *
   * Use {@link ProcessDispatcher} to manage module processes.
   *
   * @param moduleFn {Function}     Module function exposing the API for {@link ProcessDispatcher.dispatch} calls.
   * @param moduleFileName {String} File name (whole patch with file name) of the module defined by module function.
   * @param logger
   */
  static listenIPCMessages (moduleFn, moduleFileName, logger = defaultLogger) {

    /**
     * Only enable listener within sub-process. See {@link ModuleProcess.init} for process.env.PROC_NAME initialization.
     */
    if (process.env.PROC_NAME === moduleFileName) {

      logger.debug("Mimic module as process " + process.env.PROC_NAME);

      let module;

      /**
       * Listen to IPC messages, convert them to module functionality calls (adding callback), run this calls within
       * current process and once response has come invoke callback to send (on the same IPC chanel) a response to
       * parent process.
       */
      process.on('message', (message) => {

        logger.debug("Module '" + process.env.PROC_NAME + "' has gotten message: command: " + message.command + '; ' + (message.commandId ? "commandId: " + message.commandId + '; ' : '') + (message.functionName ? "functionName: " + message.functionName + '; ' : ''));

        switch (message.command) {
          // TODO : comment
          case COMMANDS.MODULE_PROCESS_COMMAND_INIT:
            let moduleOpts = message.moduleOpts;

            module = moduleFn(moduleOpts);

            if (module.init) {
              module.init(function () {
                process.send({command: message.command, callbackArguments: arguments});
              });
            } else {
              process.send({command: message.command});
            }

            break;

          // TODO : comment
          case COMMANDS.MODULE_PROCESS_COMMAND_INVOKE:
            let functionName = message.functionName;
            let params = message.params;

            let callback = function () {
              process.send({
                sendTime: message.sendTime,
                command: message.command,
                commandId: message.commandId,
                functionName: message.functionName,
                callbackArguments: arguments
              });
            };

            if (module && module[functionName]) {
              module[functionName].call(this, params)(callback);
            } else if (!module) {
              callback(new Error("Module '" + process.env.PROC_NAME + "' is not initialized"));
            } else {
              callback(new Error("'" + message.functionName + "' function does not exist in '" + process.env.PROC_NAME + "' module"));
            }

            break;
        }

      });

      /**
       * Listen to IPC chanel close-events and exit subprocess once chanel has been closed.
       * See https://nodejs.org/api/process.html#process_event_disconnect.
       *
       * Note: this is very important since the main process might have died making the module processes orphans forever.
       * The subprocess module should take care on stopping it-self in such scenarios.
       */
      process.on('disconnect', function () {
        process.exit();
      });
    }

  };

}






