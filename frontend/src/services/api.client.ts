import axios from 'axios';

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Send and receive HttpOnly cookies
  timeout: 10000,
});

// In-memory access token storage
let currentAccessToken: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem('tf_access_token') : null;

export function setApiAccessToken(token: string | null): void {
  currentAccessToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) {
      localStorage.setItem('tf_access_token', token);
    } else {
      localStorage.removeItem('tf_access_token');
    }
  }
}

export function getApiAccessToken(): string | null {
  return currentAccessToken;
}

// Request interceptor to attach Bearer token
apiClient.interceptors.request.use((config) => {
  if (currentAccessToken && config.headers) {
    config.headers.Authorization = `Bearer ${currentAccessToken}`;
  }
  return config;
});

// Response interceptor for consistent error extraction
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const errorPayload = error.response?.data?.error || {
      code: 'NETWORK_ERROR',
      message: error.message || 'Failed to communicate with TaskFlow API',
    };
    return Promise.reject(errorPayload);
  }
);
