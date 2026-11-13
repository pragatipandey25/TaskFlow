import mongoose, { Document, Model, Schema, Types } from 'mongoose';
import { JobStatus, JobPriority, JobExecutionRecord } from '@taskflow/shared';

export interface IJobDocument extends Document {
  _id: Types.ObjectId;
  jobId: string;
  userId: Types.ObjectId;
  queueName: string;
  name: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attemptsMade: number;
  maxAttempts: number;
  progress: number;
  result?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
    failedAt?: Date;
  };
  idempotencyKey?: string;
  backoff: {
    type: 'exponential' | 'fixed';
    delayMs: number;
  };
  delayMs: number;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
  lockedBy?: string;
  tags: string[];
  bullJobId?: string;
  executions: JobExecutionRecord[];
  createdAt: Date;
  updatedAt: Date;
}

const JobExecutionSchema = new Schema<JobExecutionRecord>(
  {
    attemptNumber: { type: Number, required: true },
    workerId: { type: String, required: true },
    status: {
      type: String,
      enum: ['PROCESSING', 'COMPLETED', 'FAILED'],
      required: true,
    },
    startedAt: { type: String, required: true },
    completedAt: { type: String },
    durationMs: { type: Number },
    memoryUsageBytes: { type: Number },
    cpuUsagePct: { type: Number },
    errorDetails: {
      message: { type: String },
      stack: { type: String },
      code: { type: String },
    },
    logs: [
      {
        timestamp: { type: String, required: true },
        level: { type: String, enum: ['info', 'warn', 'error'], required: true },
        message: { type: String, required: true },
      },
    ],
  },
  { _id: false }
);

const JobSchema = new Schema<IJobDocument>(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    queueName: {
      type: String,
      required: true,
      default: 'default',
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    status: {
      type: String,
      enum: Object.values(JobStatus),
      default: JobStatus.PENDING,
      index: true,
    },
    priority: {
      type: Number,
      default: JobPriority.NORMAL,
      min: 1,
      max: 10,
      index: true,
    },
    attemptsMade: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
      min: 0,
      max: 10,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    result: {
      type: Schema.Types.Mixed,
    },
    error: {
      message: { type: String },
      stack: { type: String },
      code: { type: String },
      failedAt: { type: Date },
    },
    idempotencyKey: {
      type: String,
      sparse: true,
      index: true,
    },
    backoff: {
      type: {
        type: String,
        enum: ['exponential', 'fixed'],
        default: 'exponential',
      },
      delayMs: {
        type: Number,
        default: 1000,
        min: 0,
      },
    },
    delayMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    scheduledAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },
    cancelledAt: { type: Date },
    lockedBy: { type: String },
    tags: [{ type: String, trim: true }],
    bullJobId: {
      type: String,
      sparse: true,
      index: true,
    },
    executions: {
      type: [JobExecutionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete (ret as Record<string, unknown>).__v;
        return ret;
      },
    },
  }
);

// Compound indexes for high-throughput dashboard querying, user isolation, and reconciliation
JobSchema.index({ userId: 1, status: 1, createdAt: -1 });
JobSchema.index({ queueName: 1, status: 1, createdAt: -1 });
JobSchema.index({ status: 1, priority: 1, createdAt: 1 });
JobSchema.index({ status: 1, updatedAt: 1 }); // For outbox / reconciliation sweepers

export const JobModel: Model<IJobDocument> =
  (mongoose.models.Job as Model<IJobDocument>) ||
  mongoose.model<IJobDocument>('Job', JobSchema);
