import type {
  HealthResponse,
  ReadyResponse,
  AuthUser,
  Room,
  RoomSummary,
  RoomMember,
  Visibility,
  ChatMessage,
  BookTransfer,
} from "@bookmate/contracts";

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
  async function request<T>(
    path: string,
    method = "GET",
    payload?: unknown,
  ): Promise<T> {
    const response = await fetcher(`${base}${path}`, {
      method,
      credentials: "include",
      ...(payload !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        : {}),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* Preserve plain-text proxy errors. */
    }
    if (!response.ok) throw new ApiClientError(response.status, body);
    return body as T;
  }
  const path = (id: string) => `/api/v1/rooms/${encodeURIComponent(id)}`;
  const query = (values: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) params.set(key, value);
    return params.size ? `?${params}` : "";
  };
  return {
    health: () => request<HealthResponse>("/health"),
    ready: () => request<ReadyResponse>("/health/ready"),
    register: (email: string, password: string, _legacyNickname?: string) =>
      request<{ user: AuthUser }>("/api/v1/auth/register", "POST", {
        email,
        password,
      }),
    login: (email: string, password: string) =>
      request<{ user: AuthUser }>("/api/v1/auth/login", "POST", {
        email,
        password,
      }),
    me: () => request<{ user: AuthUser }>("/api/v1/auth/me"),
    logout: () => request<void>("/api/v1/auth/logout", "POST"),
    rooms: (
      options: { scope?: "mine" | "public"; q?: string; before?: string } = {},
    ) =>
      request<{ rooms: RoomSummary[]; nextCursor: string | null }>(
        "/api/v1/rooms" + query(options),
      ),
    createRoom: (data: {
      title: string;
      bookTitle: string;
      visibility?: Visibility;
      maxMembers?: number;
    }) => request<{ room: Room }>("/api/v1/rooms", "POST", data),
    room: (id: string) => request<{ room: Room }>(path(id)),
    updateRoom: (
      id: string,
      data: {
        version: number;
        title?: string;
        visibility?: Visibility;
        maxMembers?: number;
      },
    ) => request<{ room: Room }>(path(id), "PATCH", data),
    deleteRoom: (id: string) => request<void>(path(id), "DELETE"),
    join: (id: string, inviteToken?: string) =>
      request<{ member: RoomMember }>(path(id) + "/join", "POST", {
        inviteToken,
      }),
    leave: (id: string) => request<void>(path(id) + "/membership", "DELETE"),
    invite: (id: string, maxUses = 1) =>
      request<{
        invite: {
          id: string;
          token: string;
          roomId: string;
          expiresAt: string;
          maxUses: number;
        };
      }>(path(id) + "/invites", "POST", { maxUses }),
    revokeInvite: (id: string, inviteId: string) =>
      request<void>(
        path(id) + "/invites/" + encodeURIComponent(inviteId),
        "DELETE",
      ),
    promoteAdmin: (id: string, userId: string) =>
      request<{ member: RoomMember }>(path(id) + "/admins", "POST", { userId }),
    complete: (id: string) =>
      request<{ member: RoomMember }>(path(id) + "/reading/complete", "POST"),
    transfer: (
      id: string,
      data: { id: string; toUserId: string; version: number },
    ) =>
      request<{ transfer: BookTransfer }>(
        path(id) + "/transfers",
        "POST",
        data,
      ),
    transfers: (id: string) =>
      request<{ transfers: BookTransfer[] }>(path(id) + "/transfers"),
    messages: (id: string, cursor: { after?: string; before?: string } = {}) =>
      request<{ messages: ChatMessage[]; hasMore: boolean }>(
        path(id) + "/messages" + query(cursor),
      ),
    sendMessage: (id: string, data: { id: string; text: string }) =>
      request<{ message: ChatMessage }>(path(id) + "/messages", "POST", data),
    realtimeUrl: (id: string) => {
      const url = new URL(
        `${base}${path(id)}/live`,
        typeof location === "undefined" ? undefined : location.href,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.href;
    },
  };
}
