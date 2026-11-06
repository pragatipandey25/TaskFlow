import mongoose from 'mongoose';
import { env } from './env.config.js';
import { logger } from '../core/logging/logger.js';

let isConnected = false;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (isConnected) {
    return mongoose;
  }

  mongoose.connection.on('connected', () => {
    isConnected = true;
    logger.info('MongoDB connection successfully established');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB connection disconnected');
  });

  try {
    const conn = await mongoose.connect(env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: env.NODE_ENV !== 'production',
    });
    isConnected = true;
    return conn;
  } catch (err) {
    logger.error('Failed to connect to MongoDB initially:', err);
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (isConnected) {
    await mongoose.connection.close();
    isConnected = false;
    logger.info('MongoDB connection closed gracefully');
  }
}

export function getDatabaseStatus(): {
  status: 'connected' | 'disconnected' | 'connecting' | 'disconnecting';
  readyState: number;
} {
  const readyState = mongoose.connection.readyState;
  let status: 'connected' | 'disconnected' | 'connecting' | 'disconnecting' = 'disconnected';

  if (readyState === 1) {
    status = 'connected';
  } else if (readyState === 2) {
    status = 'connecting';
  } else if (readyState === 3) {
    status = 'disconnecting';
  }

  return {
    status,
    readyState,
  };
}
