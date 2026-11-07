import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { UserProfileResponse, RegisterInput, LoginInput, UserRole } from '@taskflow/shared';
import { AuthService } from '../services/auth.service';
import { setApiAccessToken, getApiAccessToken } from '../services/api.client';

interface AuthContextType {
  user: UserProfileResponse | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginInput) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (requiredRole: UserRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfileResponse | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(getApiAccessToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initialize session on page mount
  const initAuth = useCallback(async () => {
    setIsLoading(true);
    const storedToken = getApiAccessToken();

    if (storedToken) {
      try {
        const userProfile = await AuthService.getMe();
        setUser(userProfile);
      } catch {
        // Access token might be expired, attempt refresh
        try {
          const authRes = await AuthService.refresh();
          setAccessToken(authRes.tokens.accessToken);
          setApiAccessToken(authRes.tokens.accessToken);
          setUser(authRes.user);
        } catch {
          // Both access token and refresh token failed, clear state
          setAccessToken(null);
          setApiAccessToken(null);
          setUser(null);
        }
      }
    } else {
      // Try cookie-based refresh
      try {
        const authRes = await AuthService.refresh();
        setAccessToken(authRes.tokens.accessToken);
        setApiAccessToken(authRes.tokens.accessToken);
        setUser(authRes.user);
      } catch {
        setAccessToken(null);
        setUser(null);
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const login = async (credentials: LoginInput): Promise<void> => {
    const authRes = await AuthService.login(credentials);
    setAccessToken(authRes.tokens.accessToken);
    setApiAccessToken(authRes.tokens.accessToken);
    setUser(authRes.user);
  };

  const register = async (data: RegisterInput): Promise<void> => {
    const authRes = await AuthService.register(data);
    setAccessToken(authRes.tokens.accessToken);
    setApiAccessToken(authRes.tokens.accessToken);
    setUser(authRes.user);
  };

  const logout = async (): Promise<void> => {
    try {
      await AuthService.logout();
    } finally {
      setAccessToken(null);
      setApiAccessToken(null);
      setUser(null);
    }
  };

  const hasRole = (requiredRole: UserRole): boolean => {
    if (!user) return false;
    if (user.role === UserRole.ADMIN) return true;
    if (requiredRole === UserRole.VIEWER) return true;
    if (requiredRole === UserRole.DEVELOPER) return user.role === UserRole.DEVELOPER;
    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
