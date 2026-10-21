import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * Minimal durable job queue stored in MongoDB (no Redis required for the MVP). Workers claim jobs with
 * an atomic findOneAndUpdate, so several API instances can share the queue safely.
 */
const jobSchema = new Schema(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    /** Optional idempotency key: a second enqueue with the same key is ignored while the first is live. */
    dedupeKey: { type: String, default: null },
    status: { type: String, enum: ['queued', 'running', 'succeeded', 'failed'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    runAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    lastError: String,
    finishedAt: Date,
  },
  { timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' }, status: { $in: ['queued', 'running'] } } });
jobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
export type JobDoc = HydratedDocument<InferSchemaType<typeof jobSchema>>;
export const Job = model('Job', jobSchema);
