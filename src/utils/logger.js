import path from 'path';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
};

// const logLevels = {
//   error: { color: colors.brightRed, label: 'ERROR', icon: '❌' },
//   warn: { color: colors.brightYellow, label: 'WARN', icon: '⚠️' },
//   info: { color: colors.brightCyan, label: 'INFO', icon: 'ℹ️' },
//   success: { color: colors.brightGreen, label: 'SUCCESS', icon: '✅' },
//   debug: { color: colors.dim, label: 'DEBUG', icon: '🐛' },
// };

const logLevels = {
  error: { color: colors.brightRed, label: 'ERROR', icon: '' },
  warn: { color: colors.brightYellow, label: 'WARN', icon: '' },
  info: { color: colors.brightCyan, label: 'INFO', icon: '' },
  success: { color: colors.brightGreen, label: 'SUCCESS', icon: '' },
  debug: { color: colors.dim, label: 'DEBUG', icon: '' },
};


class Logger {
  constructor(options = {}) {
    this.prefix = options.prefix || '';
    this.showTimestamp = options.showTimestamp ?? true;
    this.showLocation = options.showLocation ?? true;
    this.minLevel = options.minLevel || 'debug';
    this.levelPriority = { error: 0, warn: 1, info: 2, success: 3, debug: 4 };
  }

  _getCallerInfo() {
    const originalFunc = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const error = new Error();
    const stack = error.stack;
    Error.prepareStackTrace = originalFunc;
    
    // Stack: [0] _getCallerInfo, [1] _log, [2] public method (info/error/etc), [3] actual caller
    if (stack && stack.length >= 5) {
      const callerFrame = stack[4];
      if (callerFrame && callerFrame.getFileName) {
        const fileName = callerFrame.getFileName();
        const lineNumber = callerFrame.getLineNumber();
        return { fileName: fileName, lineNumber };
      }
    }
    return { fileName: 'unknown', lineNumber: 0 };
  }

  _log(level, ...args) {
    if (this.levelPriority[level] > this.levelPriority[this.minLevel]) return;

    const config = logLevels[level];
    const { fileName, lineNumber } = this._getCallerInfo();
    
    const timestamp = this.showTimestamp 
      ? `${colors.dim}[${new Date().toISOString().slice(11, 23)}]${colors.reset} ` 
      : '';
    
    const location = this.showLocation
      ? `${colors.dim}${fileName}:${lineNumber}${colors.reset} `
      : '';
    
    const levelStr = `${config.color}${config.icon} ${config.label}${colors.reset} `;
    const prefix = this.prefix ? `${colors.bold}[${this.prefix}]${colors.reset} ` : '';
    
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try { return JSON.stringify(arg, null, 2); }
        catch { return String(arg); }
      }
      return String(arg);
    }).join(' ');
    
    console.log(`${timestamp}${location}${levelStr}${prefix}${message}`);
  }

  error(...args) { this._log('error', ...args); }
  warn(...args) { this._log('warn', ...args); }
  info(...args) { this._log('info', ...args); }
  success(...args) { this._log('success', ...args); }
  debug(...args) { this._log('debug', ...args); }

  create(prefix) {
    return new Logger({ ...this, prefix });
  }

  setLevel(level) { this.minLevel = level; }
}

const defaultLogger = new Logger();

export const log = {
  error: (...args) => defaultLogger.error(...args),
  warn: (...args) => defaultLogger.warn(...args),
  info: (...args) => defaultLogger.info(...args),
  success: (...args) => defaultLogger.success(...args),
  debug: (...args) => defaultLogger.debug(...args),
  create: (prefix) => defaultLogger.create(prefix),
  setLevel: (level) => defaultLogger.setLevel(level),
};

export default Logger;
export { Logger, colors };
