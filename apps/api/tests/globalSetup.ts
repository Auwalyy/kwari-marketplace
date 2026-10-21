import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Starts one in-memory replica set for the whole run (replica set => multi-document transactions are
 * exercised exactly as on Atlas). Each test file uses its own database on it.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function setup({ provide }: { provide: (key: string, value: string) => void }) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  provide('mongoUri', replSet.getUri());
}

export async function teardown() {
  await replSet?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
