/**
 * @file {@link ModuleProcess} represents a wrapper enabling interprocess communication functionality for
 * arbitrary module which engages it to be available as a sub-process invocation. {@link ModuleProcess} is a core part
 * of sub-processing dispatching.
 * @author Denis Ilguzin
 */

var childProcess = require("child_process");

var stringify  = require('json-stringify-safe');
var _  = require('underscore');

var COMMANDS = require("./commands");
var defaultLogger = require("./utils").logger;

/**
 * <p>Callback to run on function finished. <i>Note: It might contain arbitrary number of arguments (required at
 * least one - error)</i></p>
 *
 * @callback ModuleProcess~onReadyCallback
 * @param error {Error}   An Error object if the callback has raised an error.
 */

/**
 * <p>Function (defined on wrapped module) to run right after caller has requested
 * the {@link ModuleProcess} to stop its sub-process but before it has been actually stopped.</p>
 *
 * @callback ModuleProcess~beforeModuleProcessStop
 * @param error {Error}   An Error object if the callback has raised an error.
 */

/**
 * <p>ModuleProcess</p>
 *
 * <p>A wrapper for module to make it running its functionality within subprocess accepting IPC messages
 * as commands.</p>
 *
 * <p>The main purpose of the {@link ModuleProcess} is to invoke within subprocess any module function by name
 * (available via module.exports of wrapped module) passing parameters to it (see {@link ModuleProcess.invoke}
 * for details). The function name to call and parameters are accepted via IPC, the callback invoked then on IPC
 * chanel in form of message back to parent.</p>
 *
 * @param moduleName {String}   Module name (script file name). E.g. __filename
 * @param moduleOpts {Object}   Options object to pass to the module
 * @param logger
 * @class
 */
function ModuleProcess (moduleName, moduleOpts, logger) {

  if (logger === undefined) { logger = defaultLogger; }

  this._initialized = false;
  this._stopped = false;

  this.moduleName = moduleName;
  this.moduleOpts = moduleOpts;

  this.invokeCallbacks = {};

  this.logger = logger;
}

/**
 * <p>Create listener to catch the IPC messages within the process the module is running in.</p>
 *
 * <p><i>Important: The module should be running within process otherwise registering listener makes no sense.
 * This will invoke process.on('message', function() {}) to listen for parent process commands.</i></p>
 *
 * <p>Use {@link ProcessDispatcher} to manage module processes.</p>
 *
 * @param moduleFn {Function}     Module function exposing the API for {@link ProcessDispatcher.dispatch} calls.
 * @param moduleFileName {String} File name (whole patch with file name) of the module defined by module function.
 * @param logger
 */
ModuleProcess.listenIPCMessages = function(moduleFn, moduleFileName, logger) {

  if (logger === undefined) { logger = defaultLogger; }

  /**
   * Only enable listener within sub-process. See {@link ModuleProcess.init} for process.env.PROC_NAME initialization.
   */
  if (process.env.PROC_NAME === moduleFileName) {

    logger.debug("Mimic module as process " + process.env.PROC_NAME);

    var module;

    /**
     * Listen to IPC messages, convert them to module functionality calls (adding callback), run this calls within
     * current process and once response has come invoke callback to send (on the same IPC chanel) a response to
     * parent process.
     */
    process.on('message', function(message) {

      logger.debug("Module '" + process.env.PROC_NAME + "' has gotten message: command: " + message.command + '; ' + (message.commandId ? "commandId: " + message.commandId + '; ' : '') + (message.functionName ? "functionName: " + message.functionName + '; ' : ''));

      var callback;

      switch (message.command) {
        // TODO : comment
        case COMMANDS.MODULE_PROCESS_COMMAND_INIT:
          var moduleOpts = message.moduleOpts;

          module = moduleFn(moduleOpts);

          if (module.init) {
            module.init(function () {
              process.send({command: message.command, callbackArguments: arguments});
            });
          } else {
            process.send({command: message.command});
          }

          break;

        case COMMANDS.MODULE_PROCESS_COMMAND_STOP:

          var force = message.params.force;

          callback = function () {
            process.send({
              sendTime: message.sendTime,
              command: message.command,
              commandId: message.commandId,
              callbackArguments: arguments
            });
            /** Exit if no error raised by {@link ModuleProcess~beforeModuleProcessStop} or force flag set to True */
            var error = arguments[0];
            if (!error || force) { setTimeout(function() { process.exit(0); }, 10); }
          };

          var beforeModuleProcessStopFnName = "beforeModuleProcessStop";

          if (!module) {
            callback(new Error("Module '" + process.env.PROC_NAME + "' is not initialized"));
          } else if (module && module[beforeModuleProcessStopFnName]) {
            module[beforeModuleProcessStopFnName].call(module, params)(callback);
          } else {
            callback();
          }

          break;

        // TODO : comment
        case COMMANDS.MODULE_PROCESS_COMMAND_INVOKE:
          var functionName = message.functionName;
          var params = message.params;

          callback = function () {
            process.send({
              sendTime: message.sendTime,
              command: message.command,
              commandId: message.commandId,
              functionName: message.functionName,
              callbackArguments: arguments
            });
          };

          if (module && module[functionName]) {
            module[functionName].call(module, params)(callback);
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

/**
 * <p>Make unique command token to use in send/receive model to distinguish calls for the child process.</p>
 *
 * @param command {string}    A {@link COMMANDS} definition for possible commands.
 * @returns {string}          Token
 */
ModuleProcess.makeCommandId = function(command) {
  return command + "-" + (new Date().getTime()).toString() + "-" + process.hrtime()[1];
};

/**
 * <p>Bind callback to unique command id (or token) to be called once function finished.</p>
 *
 * @param commandId {String}                        Unique string Token. See. {@link ModuleProcess.makeCommandId}
 * @param callback {ModuleProcess~onReadyCallback} Callback to run on function finished.
 */
ModuleProcess.prototype.addCallback = function(commandId, callback) {
  this.invokeCallbacks[commandId] = callback;
};

/**
 * <p>Unbind callback from Token. See. {@link ModuleProcess.addCallback}.</p>
 *
 * @param commandId {String}  Unique string token. See. {@link ModuleProcess.makeCommandId}
 */
ModuleProcess.prototype.removeCallback = function(commandId) {
  delete this.invokeCallbacks[commandId];
};

/**
 * <p>Get callback by token. See. {@link ModuleProcess.addCallback}, {@link ModuleProcess.makeCommandId}.</p>
 *
 * @param commandId {String}  Unique string token. See. {@link ModuleProcess.makeCommandId}.
 * @return callback {ModuleProcess~onInvokeCallback}  Callback function that has been stored for this commandId.
 */
ModuleProcess.prototype.getCallback = function(commandId) {
  return this.invokeCallbacks[commandId];
};

/**
 * <p>Initialize child process and incoming commands listener.</p>
 *
 * <p>This will do the following steps:
 *
 * <ul>
 *   <li>- Prepare options to be passed for module (functionality options) and process (environment mostly) initialization</li>
 *   <li>- Fork new subprocess from {@link moduleName}</li>
 *   <li>- Start listening incoming IPC messages from forked sub-process to current process:
 *     <ul>
 *       <li>- <i>init command response</i>: will invoke the {@link ModuleProcess.init} function callback, notifying
 *       the module has been initialized in subprocess</li>
 *       <li>- <i>other command response</i>: will invoke a callback registered with {@link addCallback} on incoming
 *       command call via {@link ModuleProcess.invoke}.</li>
 *     </ul>
 *   </li>
 * </ul>
 *
 * @param callback {ModuleProcess~onReadyCallback} Callback to run on initialization has finished.
 */
ModuleProcess.prototype.init = function(callback) {

  this.logger.debug("Init module process on " + this.moduleName);

  //
  if (this._initialized) {
    this.logger.warn("Already initialized");
    return callback(null, this);
  }
  // var debugPort = parseInt(process.pid);

  /**
   * Prepare the options object to be used for forking child process.
   * See. https://nodejs.org/api/child_process.html#child_process_child_process_fork_modulepath_args_options
   */
  var processOpts = _.extend({}, this.moduleOpts.process);

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
  this.childProcess.on('message', (function(cpResponseMessage) {

    var timeElapsed =
      cpResponseMessage.sendTime ? (new Date().getTime() - cpResponseMessage.sendTime) : null;

    this.logger.debug("Module '" + this.moduleName + "' process responded: " +
      "command: " + cpResponseMessage.command +
      (cpResponseMessage.commandId ? "; commandId: " + cpResponseMessage.commandId : '') +
      (cpResponseMessage.functionName ? "; functionName: " + cpResponseMessage.functionName : '') +
      (timeElapsed ? "; time: +" + timeElapsed + "ms" : '')
    );

    var args = cpResponseMessage.callbackArguments ? _.values(cpResponseMessage.callbackArguments) : [];

    switch (cpResponseMessage.command) {
      case COMMANDS.MODULE_PROCESS_COMMAND_INIT:
        var error = args[0];
        if (!error) {
          this._stopped = false;
          this._initialized = true;
        }
        callback(error, !error ? this : null);
        break;
      case COMMANDS.MODULE_PROCESS_COMMAND_STOP:
        this._stopped = true;
        // Get a callback stored for the response command id
        var stopCallback = this.getCallback(cpResponseMessage.commandId);
        if (stopCallback) {
          stopCallback.apply(this, args);                     // Invoke callback and
          this.removeCallback(cpResponseMessage.commandId);   // remove callback from the queue afterwards
        }
        break;
      case COMMANDS.MODULE_PROCESS_COMMAND_INVOKE:
        // Get a callback stored for the response command id
        var invokeCallback = this.getCallback(cpResponseMessage.commandId);
        if (invokeCallback) {
          invokeCallback.apply(this, args);                   // Invoke callback and
          this.removeCallback(cpResponseMessage.commandId);   // remove callback from the queue afterwards
        }
        break;
    }

  }).bind(this));

  this.moduleOpts = JSON.parse(stringify(this.moduleOpts, null, 2, null));
  // Send first initializing call
  this.childProcess.send({command: COMMANDS.MODULE_PROCESS_COMMAND_INIT, moduleOpts: this.moduleOpts});


};

/**
 * <p>Request a functionName to be called within subprocess with supplied parameters.
 * This call return a callback-style function wrapping the invoked function. See invokeExample.js below.</p>
 *
 * <p>Behind the scenes...</p>
 *
 * <p>The function invocation workflow is based on the following:</p>
 *
 * <p>1. On {@link ModuleProcess} init the module is wrapped by subprocess. Since that the {@link ModuleProcess} object
 *  API contains module members that are exposed via {@link ProcessDispatcher.listenIPCMessages}.
 *  First parameter in {@link ProcessDispatcher.listenIPCMessages} is 'moduleFn' (function(moduleOpts) { ... }).
 *  {@link moduleOpts} is used eventually as 'moduleOpts' parameter for that function.
 *  Then the functionName passed to the {@link ModuleProcess.invoke} is one of that functions installed via
 *  {@link ProcessDispatcher.listenIPCMessages} invocation.</p>
 *
 *  <p>2. Once functionName invocation requested the callback is registered for that particular function call (i.e.
 *  unique token created for the function call)</p>
 *
 *  <p>3. Later under the hood the callback will be called when the subprocess that wraps the module will respond via
 *  IPC message to its parent process. The response will be caught by {@link ModuleProcess} functionality.
 *  To understand that see how initialization goes in {@link ModuleProcess.init}, the
 *  "case COMMANDS.MODULE_PROCESS_COMMAND_INVOKE" block is what catching command result responses and calling callback
 *  that is registered when {@link ModuleProcess.invoke} has been called.</p>
 *
 * @example <caption>invokeExample.js</caption>
 * var modProc = ...; // modProc is instance of ModuleProcess
 * modProc.invoke('foo', {param1: "test"})(function(error, result) {
 *   console.log("result is ", result);
 * });
 *
 * @param functionName {string}   Function name to be invoked. It is a wrapped module module.export member.
 * @param params {object}         Params to be passed to function.
 * @returns {ModuleProcess~onReadyCallback}  A callback function to be run on command invocation has finished.
 */
ModuleProcess.prototype.invoke = function(functionName, params) {
  // TODO : check if this.childProcess is not null

  var _this = this;

  var commandId = ModuleProcess.makeCommandId(COMMANDS.MODULE_PROCESS_COMMAND_INVOKE);

  /**
   * The {@param callback} will be invoked by {@link getCallback} from within {@link init} function
   * within {@link COMMANDS.MODULE_PROCESS_COMMAND_INVOKE} command branch.
   */
  return function(callback) {

    _this.addCallback(commandId, callback);

    _this.childProcess.send({
      sendTime: new Date().getTime(),
      command: COMMANDS.MODULE_PROCESS_COMMAND_INVOKE,
      commandId: commandId,
      functionName: functionName,
      params: params
    });

  };
};

/**
 * Stops {@link ModuleProcess} sub-process executing {@link ModuleProcess~beforeModuleProcessStop} function if any
 * defined on the module.
 *
 * @param force {boolean} Force exit the process even if {@link ModuleProcess~beforeModuleProcessStop} completed
 *                        with error.
 * @returns {Function}    Function with the only argument which is {@link ModuleProcess~onReadyCallback} to be
 *                        executed once "stop" invocation has been processed.
 */
ModuleProcess.prototype.stop = function(force) {
  var _this = this;

  var commandId = ModuleProcess.makeCommandId(COMMANDS.MODULE_PROCESS_COMMAND_STOP);

  /**
   * The {@param callback} will be invoked by {@link getCallback} from within {@link init} function
   * within {@link COMMANDS.MODULE_PROCESS_COMMAND_STOP} command branch.
   */
  return function(callback) {
    _this.addCallback(commandId, callback);

    _this.childProcess.send({
      sendTime: new Date().getTime(),
      command: COMMANDS.MODULE_PROCESS_COMMAND_STOP,
      commandId: commandId,
      params: {force: force}
    });

  };
};

module.exports = ModuleProcess;
