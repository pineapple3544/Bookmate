import type { HealthResponse, ReadyResponse } from "@bookmate/contracts";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiClientError";
  }
}

export function createApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const base = baseUrl.replace(/\/$/, "");
  async function get<T>(path: string): Promise<T> {
    const response = await fetcher(`${base}${path}`, {
      credentials: "include",
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* Preserve proxy errors that return plain text. */
    }
    if (!response.ok) throw new ApiClientError(response.status, body);
    return body as T;
  }
  return {
    health: () => get<HealthResponse>("/health"),
    ready: () => get<ReadyResponse>("/health/ready"),
  };
}
