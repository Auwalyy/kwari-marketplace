import { Job, type JobDoc } from './job.model';
import { logger } from '../config/logger';

export type JobHandler = (payload: Record<string, unknown>, job: JobDoc) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export async function enqueueJob(
  type: string,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
): Promise<void> {
  try {
    await Job.create({
      type,
      payload,
      dedupeKey: opts.dedupeKey ?? null,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
    });
  } catch (err) {
    // Duplicate dedupeKey: an identical job is already queued or running.
    if ((err as { code?: number }).code === 11000) return;
    throw err;
  }
}

/** Exponential backoff: 30s, 2m, 8m, 32m … capped at 6h. */
function backoffMs(attempt: number) {
  return Math.min(30_000 * 4 ** (attempt - 1), 6 * 3600_000);
}

async function claimNext(): Promise<JobDoc | null> {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      $or: [
        { status: 'queued', runAt: { $lte: now } },
        // Recover jobs whose worker died mid-run.
        { status: 'running', lockedUntil: { $lt: now } },
      ],
    },
    { $set: { status: 'running', lockedUntil: new Date(now.getTime() + 5 * 60_000) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true },
  );
}

export async function runJob(job: JobDoc): Promise<void> {
  const handler = handlers.get(job.type);
  if (!handler) {
    await Job.updateOne({ _id: job._id }, { $set: { status: 'failed', lastError: `No handler for ${job.type}`, finishedAt: new Date() } });
    return;
  }
  try {
    await handler(job.payload as Record<string, unknown>, job);
    await Job.updateOne({ _id: job._id }, { $set: { status: 'succeeded', finishedAt: new Date(), lockedUntil: null } });
  } catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? 'unknown error';
    const exhausted = job.attempts >= job.maxAttempts;
    logger.warn({ jobId: String(job._id), type: job.type, attempt: job.attempts, exhausted, error: message }, 'Job failed');
    await Job.updateOne(
      { _id: job._id },
      exhausted
        ? { $set: { status: 'failed', lastError: message, finishedAt: new Date(), lockedUntil: null } }
        : { $set: { status: 'queued', lastError: message, runAt: new Date(Date.now() + backoffMs(job.attempts)), lockedUntil: null } },
    );
  }
}

/** Processes due jobs until none remain (used by tests and the worker loop). */
export async function drainJobs(max = 100): Promise<number> {
  let n = 0;
  while (n < max) {
    const job = await claimNext();
    if (!job) break;
    await runJob(job);
    n++;
  }
  return n;
}

let timer: NodeJS.Timeout | null = null;
let stopping = false;

export function startJobWorker(intervalMs = 2000) {
  stopping = false;
  const tick = async () => {
    if (stopping) return;
    try {
      await drainJobs(25);
    } catch (err) {
      logger.error({ err }, 'Job worker tick failed');
    }
    if (!stopping) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  logger.info('Background job worker started');
}

export function stopJobWorker() {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
