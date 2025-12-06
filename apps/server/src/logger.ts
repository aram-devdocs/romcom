/**
 * Logger configuration using Pino
 */

import { pino, type Logger, type LoggerOptions } from 'pino';

const logLevel = process.env['LOG_LEVEL'] ?? 'info';
const isDev = process.env['NODE_ENV'] !== 'production';

function createBaseLogger(): Logger {
  const options: LoggerOptions = {
    level: logLevel,
  };

  if (isDev) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(options);
}

const baseLogger = createBaseLogger();

/**
 * Create a child logger with a specific component label
 */
export function createLogger(component: string): Logger {
  return baseLogger.child({ component });
}

export default baseLogger;
