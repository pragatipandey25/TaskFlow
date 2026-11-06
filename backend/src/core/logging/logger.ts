import winston from 'winston';
import { env } from '../../config/env.config.js';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// Human-readable format for development
const devFormat = printf(({ level, message, timestamp, stack, correlationId, ...meta }) => {
  const cid = correlationId ? `[${correlationId}] ` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const errStack = stack ? `\n${stack}` : '';
  return `${timestamp} ${level}: ${cid}${message}${metaStr}${errStack}`;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    errors({ stack: true }),
    env.NODE_ENV === 'production' ? json() : combine(colorize(), devFormat)
  ),
  defaultMeta: { service: 'taskflow-backend' },
  transports: [
    new winston.transports.Console(),
  ],
});
