import { Schema, model, Document, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { UserRole, UserProfileResponse } from '@taskflow/shared';
import { env } from '../config/env.config.js';

// Use fast salt rounds in automated test suites for sub-millisecond execution
const BCRYPT_SALT_ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidatePassword: string): Promise<boolean>;
  toProfile(): UserProfileResponse;
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false, // Do not return passwordHash in regular queries
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.DEVELOPER,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Method to verify candidate password
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Method to return sanitized public user profile
UserSchema.methods.toProfile = function (): UserProfileResponse {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    isActive: this.isActive,
    lastLoginAt: this.lastLoginAt ? this.lastLoginAt.toISOString() : undefined,
    createdAt: this.createdAt.toISOString(),
    updatedAt: this.updatedAt.toISOString(),
  };
};

// Static helper for hashing passwords
export async function hashPassword(plaintextPassword: string): Promise<string> {
  return bcrypt.hash(plaintextPassword, BCRYPT_SALT_ROUNDS);
}

export const UserModel = model<IUser>('User', UserSchema);
