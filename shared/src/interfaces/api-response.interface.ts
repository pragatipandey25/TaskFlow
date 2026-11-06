export interface APIErrorDetail {
  field?: string;
  issue: string;
}

export interface APIErrorResponse {
  code: string;
  message: string;
  details?: APIErrorDetail[];
  timestamp: string;
  correlationId?: string;
}

export interface PaginationMeta {
  totalItems: number;
  totalPages: number;
  currentPage: number;
  limit: number;
}

export interface APISuccessResponse<T> {
  success: true;
  data: T;
  pagination?: PaginationMeta;
  message?: string;
}

export interface APIFailureResponse {
  success: false;
  error: APIErrorResponse;
}

export type APIResponse<T> = APISuccessResponse<T> | APIFailureResponse;
