export const API_VERSION = "v1";

export interface HealthResponse {
  status: "ok";
}

export interface ReadyResponse {
  status: "ready";
}

export interface ApiError {
  error: {
    code:
      | "BAD_REQUEST"
      | "NOT_FOUND"
      | "INTERNAL_ERROR"
      | "DATABASE_UNAVAILABLE";
    message: string;
    requestId: string;
  };
}
