import mongoose, { type ClientSession } from 'mongoose';
import { env } from './env';
import { logger } from './logger';

// NoSQL-injection defence: every request input is parsed by zod into primitive types before it reaches a
// query, and `rejectOperatorKeys` middleware refuses `$`/dotted keys. strictQuery drops unknown paths.
mongoose.set('strictQuery', true);

export async function connectDatabase(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  if (!uri) throw new Error('MONGODB_URI is not configured');
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    autoIndex: env.NODE_ENV !== 'production',
  });
  logger.info({ host: conn.connection.host, db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

let transactionsSupported: boolean | null = null;

async function detectTransactions(): Promise<boolean> {
  if (!env.MONGODB_TRANSACTIONS) return false;
  if (transactionsSupported !== null) return transactionsSupported;
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    transactionsSupported = false;
  }
  if (!transactionsSupported) logger.warn('MongoDB deployment does not support transactions; falling back to atomic single-document updates');
  return transactionsSupported;
}

/**
 * Runs `fn` inside a transaction when the deployment supports it (replica set / Atlas). On standalone
 * servers it runs without a session; callers must therefore still use conditional atomic updates
 * (e.g. `$inc` guarded by a stock filter) so correctness never depends solely on the transaction.
 */
export async function withTransaction<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!(await detectTransactions())) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export function resetTransactionDetection(): void {
  transactionsSupported = null;
}
