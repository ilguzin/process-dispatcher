
import * as childProcess from "child_process";
import * as _ from "underscore";

import stringify from 'json-stringify-safe';

import {COMMANDS} from "./const";
import {logger as defaultLogger} from "./utils";

/**
 * ModuleProcess
 *
 * A wrapper for module to make it running its functionality within subprocess accepting IPC messages
 * as commands.
 *
 * The main purpose of the {@link ModuleProcess} is to invoke within subprocess any module function by name
 * (available via module.exports of wrapped module) passing parameters to it (see {@link ModuleProcess.invoke}
 * for details). The function name to call and parameters are accepted via IPC, the callback invoked then on IPC
 * chanel in form of message back to parent.
 *
 * @param moduleName {String}   Module name (script file name). E.g. __filename global let
 * @param moduleOpts {Object}   Options object to pass to the module
 * @constructor
 */
export class ModuleProcess {

  constructor (moduleName, moduleOpts, logger = defaultLogger) {
    this._initialized = false;

    this.moduleName = moduleName;
    this.moduleOpts = moduleOpts;

    this.invokeCallbacks = {};

    this.logger = logger;
  }

  /**
   * Make unique command token to use in send/receive model to distinguish calls for the child process.
   *
   * @param command       See {@link COMMANDS} definition for possible commands.
   * @returns {string}
   */
  static makeCommandId (command) {
    return command + "-" + (new Date().getTime()).toString() + "-" + process.hrtime()[1];
  }

  /**
   * Bind callback to unique command id (or token) to be called once function finished.
   *
   * @param commandId {String}  Unique string token. See. {@link ModuleProcess.makeCommandId}
   * @param callback {Function} Callback to run on function finished.
   */
  addCallback (commandId, callback) {
    this.invokeCallbacks[commandId] = callback;
  };

  /**
   * Unbind callback from token. See. {@link ModuleProcess.addCallback}.
   *
   * @param commandId {String}  Unique string token. See. {@link ModuleProcess.makeCommandId}
   */
  removeCallback (commandId) {
    delete this.invokeCallbacks[commandId];
  };

  /**
   * Get callback by token. See. {@link ModuleProcess.addCallback}, {@link ModuleProcess.makeCommandId}.
   *
   * @param commandId {String}  Unique string token. See. {@link ModuleProcess.makeCommandId}
   * @return {Function}         Callback function that has been stored for this commandId.
   */
  getCallback (commandId) {
    return this.invokeCallbacks[commandId];
  };

  /**
   * Initialize child process and incoming commands listener.
   *
   * This will do the following steps:
   *
   *  - Prepare options to be passed for module (functionality options) and process (environment mostly) initialization
   *
   *  - Fork new subprocess from {@link moduleName}
   *
   *  - Start listening incoming IPC messages from forked sub-process to current process:
   *
   *    - _init command response_: will invoke the {@link ModuleProcess.init} function callback, notifying the module
   *    has been initialized in subprocess
   *
   *    - _other command response_: will invoke a callback registered with {@link addCallback} on incoming
   *    command call via {@link ModuleProcess.invoke}.
   *
   * @param callback
   */
  init (callback) {

    this.logger.debug("Init module process on " + this.moduleName);

    //
    if (this._initialized) {
      this.logger.warn("Already initialized");
      return callback(null, this);
    }
    // let debugPort = parseInt(process.pid);

    /**
     * Prepare the options object to be used for forking child process.
     * See. https://nodejs.org/api/child_process.html#child_process_child_process_fork_modulepath_args_options
     */
    let processOpts = _.extend({}, this.moduleOpts.process);

    /**
     * Extend and inherit from current process (main process) environment in sub-process
     */
    processOpts.env = _.extend(
      {},                             // To create new env object instead mutating current
      process.env,                    // Inherit from current process env object
      processOpts.env,                // Inherit from config modulesprocdisp.XXX.process.env if any
      {PROC_NAME: this.moduleName}    // Env settings required by the ModuleProcess functionality
    );

    this.childProcess = childProcess.fork(this.moduleName, processOpts);

    /**
     * Install per {@link ModuleProcess}-instance IPC messages listener.
     *
     * For arbitrary function call (see {@link ModuleProcess.invoke}) will get responses from module from within
     * subprocess and execute previously registered (see invocation of {@link ModuleProcess.addCallback} inside
     * {@link ModuleProcess.invoke}) callback.
     *
     * For first initialization function call
     * (see "this.childProcess.send({command: COMMANDS.MODULE_PROCESS_COMMAND_INIT, ...})" invocation later) will
     * run callback function passed to {@link ModuleProcess.init}
     */
    this.childProcess.on('message', (cpResponseMessage) => {

      this.logger.debug("Incoming message " + cpResponseMessage);

      let timeElapsed =
        cpResponseMessage.sendTime ? (new Date().getTime() - cpResponseMessage.sendTime) : null;

      this.logger.debug("Module '" + this.moduleName + "' process responded: " +
        "command: " + cpResponseMessage.command +
        (cpResponseMessage.commandId ? "; commandId: " + cpResponseMessage.commandId : '') +
        (cpResponseMessage.functionName ? "; functionName: " + cpResponseMessage.functionName : '') +
        (timeElapsed ? "; time: +" + timeElapsed + "ms" : '')
      );

      let args = cpResponseMessage.callbackArguments ? _.values(cpResponseMessage.callbackArguments) : [];

      switch (cpResponseMessage.command) {
        case COMMANDS.MODULE_PROCESS_COMMAND_INIT:
          let error = args[0];
          if (!error) {
            this._initialized = true;
          }
          callback(error, !error ? this : null);
          break;
        case COMMANDS.MODULE_PROCESS_COMMAND_INVOKE:
          // Get a callback stored for the response command id
          let invokeCallback = this.getCallback(cpResponseMessage.commandId);
          if (invokeCallback) {
            invokeCallback.apply(this, args);                   // Invoke callback and
            this.removeCallback(cpResponseMessage.commandId);  // remove callback from the queue afterwards
          }
          break;
      }

    });

    this.moduleOpts = JSON.parse(stringify(this.moduleOpts, null, 2, null));
    // Send first initializing call
    this.childProcess.send({command: COMMANDS.MODULE_PROCESS_COMMAND_INIT, moduleOpts: this.moduleOpts});


  };

  /**
   * Request a functionName to be called within subprocess with supplied parameters.
   * This call return a callback-style function wrapping the invoked function. I.e.
   *
   * @example
   *   let modProc = ...; // modProc is instance of ModuleProcess
   *
   *   modProc.invoke('foo', {param1: "test"})(function(error, result) {
   *     console.log("result is ", result);
   *   });
   *
   *
   * Behind the scenes...
   *
   * The function invocation workflow is based on the following:
   *
   *  - On {@link ModuleProcess} init the module is wrapped by subprocess. Since that the {@link ModuleProcess} object
   *  API contains module members that are exposed via {@link ProcessDispatcher.listenIPCMessages}.
   *  First parameter in {@link ProcessDispatcher.listenIPCMessages} is 'moduleFn' (function(moduleOpts) { ... }).
   *  {@link moduleOpts} is used eventually as 'moduleOpts' parameter for that function.
   *  Then the functionName passed to the {@link ModuleProcess.invoke} is one of that functions installed via
   *  {@link ProcessDispatcher.listenIPCMessages} invocation.
   *
   *  - Once functionName invocation requested the callback is registered for that particular function call (i.e.
   *  unique token created for the function call)
   *
   *  - Later under the hood the callback will be called when the subprocess that wraps the module will respond via
   *  IPC message to its parent process. The response will be caught by {@link ModuleProcess} functionality.
   *  To understand that see how initialization goes in {@link ModuleProcess.init}, the
   *  "case COMMANDS.MODULE_PROCESS_COMMAND_INVOKE" block is what catching command result responses and calling callback
   *  that is registered when {@link ModuleProcess.invoke} has been called.
   *
   *
   * @param functionName  Function name to be invoked. It is a wrapped module module.export member.
   * @param params        Params to be passed to function.
   * @returns {Function}  Return a native callback-style node function. I.e. function(error, result) { ... }
   */
  invoke (functionName, params) {
    // TODO : check if this.childProcess is not null

    let commandId = ModuleProcess.makeCommandId(COMMANDS.MODULE_PROCESS_COMMAND_INVOKE);

    /**
     * The {@param callback} will be invoked by {@link getCallback} from within {@link init} function
     * within {@link COMMANDS.MODULE_PROCESS_COMMAND_INVOKE} command branch.
     */
    return (callback) => {

      this.addCallback(commandId, callback);

      this.childProcess.send({
        sendTime: new Date().getTime(),
        command: COMMANDS.MODULE_PROCESS_COMMAND_INVOKE,
        commandId: commandId,
        functionName: functionName,
        params: params
      });

    };
  };
}






