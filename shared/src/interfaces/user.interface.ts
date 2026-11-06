import { UserRole } from '../enums/user-role.enum.js';

export interface UserProfileResponse {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: UserProfileResponse;
  tokens: AuthTokens;
}
