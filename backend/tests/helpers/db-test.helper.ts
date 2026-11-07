import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'fs';

let mongoServer: MongoMemoryServer | null = null;

const SYSTEM_MONGOD_PATH = 'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe';

export async function setupTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  const binaryOptions = fs.existsSync(SYSTEM_MONGOD_PATH)
    ? { systemBinary: SYSTEM_MONGOD_PATH }
    : undefined;

  mongoServer = await MongoMemoryServer.create({
    binary: binaryOptions,
  });

  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}

export async function clearTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0 && mongoose.connection.db) {
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  }
}

export async function teardownTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}
