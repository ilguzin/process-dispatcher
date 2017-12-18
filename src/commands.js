/**
 * @file Commands constants. Are used in IPC between {@link ModuleProcess} and its wrapped module.
 * @author Denis Ilguzin
 */

/**
 * @constant {object}  Set of commands to be used for IPC backed messages.
 */
module.exports = {
  /** @constant {string}  Initialize module. */
  MODULE_PROCESS_COMMAND_INIT: 'init',
  /** @constant {string}  Ask module process to stop. */
  MODULE_PROCESS_COMMAND_STOP: 'stop',
  /** @constant {string}  Invoke and arbitrary command/function. */
  MODULE_PROCESS_COMMAND_INVOKE: 'invoke'
};
