import mongoose, { Document, Model, Schema } from 'mongoose';
import { WorkerStatus, WorkerMetrics } from '@taskflow/shared';

export interface IWorkerDocument extends Document {
  workerId: string;
  hostname: string;
  pid: number;
  queuesSubscribed: string[];
  concurrency: number;
  activeJobCount: number;
  status: WorkerStatus;
  lastHeartbeat: Date;
  startedAt: Date;
  version: string;
  systemMetrics?: WorkerMetrics;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const WorkerSchema = new Schema<IWorkerDocument>(
  {
    workerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    hostname: {
      type: String,
      required: true,
      trim: true,
    },
    pid: {
      type: Number,
      required: true,
    },
    queuesSubscribed: {
      type: [String],
      required: true,
      default: ['default'],
    },
    concurrency: {
      type: Number,
      required: true,
      min: 1,
      default: 5,
    },
    activeJobCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(WorkerStatus),
      default: WorkerStatus.HEALTHY,
      index: true,
    },
    lastHeartbeat: {
      type: Date,
      default: Date.now,
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    version: {
      type: String,
      required: true,
      default: '1.0.0',
    },
    systemMetrics: {
      rssMemoryBytes: { type: Number },
      heapUsedBytes: { type: Number },
      cpuPercent: { type: Number },
    },
    metadata: {
      type: Schema.Types.Mixed,
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

WorkerSchema.index({ status: 1, lastHeartbeat: -1 });

export const WorkerModel: Model<IWorkerDocument> =
  (mongoose.models.Worker as Model<IWorkerDocument>) ||
  mongoose.model<IWorkerDocument>('Worker', WorkerSchema);
