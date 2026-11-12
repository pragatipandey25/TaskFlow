import { Schema, model, Document, Types } from 'mongoose';

export interface IRefreshTokenFamily extends Document {
  _id: Types.ObjectId;
  familyId: string;
  userId: Types.ObjectId;
  isRevoked: boolean;
  revokedReason?: 'ROTATION_REUSE' | 'EXPLICIT_LOGOUT' | 'ACCOUNT_DEACTIVATED' | 'ADMIN_ACTION';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RefreshTokenFamilySchema = new Schema<IRefreshTokenFamily>(
  {
    familyId: {
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
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
    revokedReason: {
      type: String,
      enum: ['ROTATION_REUSE', 'EXPLICIT_LOGOUT', 'ACCOUNT_DEACTIVATED', 'ADMIN_ACTION'],
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Automatic TTL index to purge expired token families from MongoDB
RefreshTokenFamilySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenFamilyModel = model<IRefreshTokenFamily>(
  'RefreshTokenFamily',
  RefreshTokenFamilySchema
);
