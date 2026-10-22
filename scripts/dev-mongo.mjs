/**
 * Development-only MongoDB: a persistent single-node replica set (transactions supported) using
 * mongodb-memory-server binaries, for machines without MongoDB installed.
 *
 *   node scripts/dev-mongo.mjs        -> mongodb://127.0.0.1:27017/kkdm?replicaSet=rs0
 *
 * Data is kept in .dev-mongo/ (git-ignored). Use MongoDB Atlas or a real deployment for anything else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve('apps/api/package.json'));
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const dbPath = path.resolve('.dev-mongo');
fs.mkdirSync(dbPath, { recursive: true });
const port = Number(process.env.DEV_MONGO_PORT ?? 27017);

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath }],
});
const uri = `mongodb://127.0.0.1:${port}/kkdm?replicaSet=rs0`;
console.log(`\nDevelopment MongoDB ready: ${uri}\nSet MONGODB_URI to this value in .env. Press Ctrl+C to stop.\n`);
const stop = async () => {
  await replSet.stop({ doCleanup: false, force: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
