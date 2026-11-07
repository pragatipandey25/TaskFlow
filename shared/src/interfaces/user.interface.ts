import { UserRole } from '../enums/user-role.enum.js';

export interface UserProfileResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

export interface AuthResponse {
  user: UserProfileResponse;
  tokens: AuthTokens;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RefreshTokenInput {
  refreshToken?: string;
}
