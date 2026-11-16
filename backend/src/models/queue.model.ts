import { Schema, model, Document, Types } from 'mongoose';

export enum QueueStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
}

export interface IQueueDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  defaultPriority: number;
  maxConcurrency: number;
  rateLimit: {
    maxJobs: number;
    durationMs: number;
  };
  status: QueueStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QueueSchema = new Schema<IQueueDocument>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^[a-zA-Z0-9_-]+$/, 'Queue name must be alphanumeric with underscores/hyphens'],
      index: true,
    },
    description: { type: String, maxlength: 250 },
    defaultPriority: {
      type: Number,
      default: 5,
      min: 1,
      max: 10,
    },
    maxConcurrency: {
      type: Number,
      default: 10,
      min: 1,
      max: 100,
    },
    rateLimit: {
      maxJobs: { type: Number, default: 1000 },
      durationMs: { type: Number, default: 1000 },
    },
    status: {
      type: String,
      enum: Object.values(QueueStatus),
      default: QueueStatus.ACTIVE,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

export const QueueModel = model<IQueueDocument>('Queue', QueueSchema);
