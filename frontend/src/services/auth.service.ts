import { apiClient } from './api.client';
import {
  RegisterInput,
  LoginInput,
  AuthResponse,
  UserProfileResponse,
  APISuccessResponse,
} from '@taskflow/shared';

export class AuthService {
  public static async register(data: RegisterInput): Promise<AuthResponse> {
    const res = await apiClient.post<APISuccessResponse<AuthResponse>>('/auth/register', data);
    return res.data.data;
  }

  public static async login(credentials: LoginInput): Promise<AuthResponse> {
    const res = await apiClient.post<APISuccessResponse<AuthResponse>>('/auth/login', credentials);
    return res.data.data;
  }

  public static async refresh(): Promise<AuthResponse> {
    // Refresh token is automatically sent via HttpOnly cookie or stored token
    const res = await apiClient.post<APISuccessResponse<AuthResponse>>('/auth/refresh');
    return res.data.data;
  }

  public static async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  }

  public static async getMe(): Promise<UserProfileResponse> {
    const res = await apiClient.get<APISuccessResponse<UserProfileResponse>>('/auth/me');
    return res.data.data;
  }
}
