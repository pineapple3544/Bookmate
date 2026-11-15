export const API_VERSION = "v1";

export interface HealthResponse {
  status: "ok";
}

export interface ReadyResponse {
  status: "ready";
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export interface UserSummary {
  id: string;
  nickname: string;
}
export interface AuthUser extends UserSummary {
  email: string;
}
export type Visibility = "PUBLIC" | "PRIVATE";
export interface RoomMember {
  roomId: string;
  userId: string;
  role: "ADMIN" | "MEMBER";
  readingOrder: number;
  readingStatus: "WAITING" | "READING" | "COMPLETED";
  readingStartedAt: string | null;
  readingCompletedAt: string | null;
  joinedAt: string;
  user?: UserSummary;
}
export interface RoomSummary {
  id: string;
  title: string;
  bookTitle: string;
  visibility: Visibility;
  maxMembers: number;
  version: number;
  _count: { members: number };
}
export interface Room {
  id: string;
  title: string;
  bookTitle: string;
  visibility: Visibility;
  maxMembers: number;
  version: number;
  hostEpoch: string;
  bookHolderId: string | null;
  createdAt: string;
  updatedAt: string;
  members?: RoomMember[];
}
export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  sequence: string;
  text: string;
  createdAt: string;
}
export interface BookTransfer {
  id: string;
  roomId: string;
  fromUserId: string;
  toUserId: string;
  version: number;
  createdAt: string;
}
export type RealtimeEvent =
  | {
      type: "presence";
      onlineUserIds: string[];
      hostUserId: string | null;
      hostEpoch: string;
      positions: Record<string, { x: number; y: number }>;
    }
  | { type: "move"; userId: string; x: number; y: number }
  | {
      type: "signal";
      fromUserId: string;
      hostEpoch: string;
      kind: "offer" | "answer" | "ice";
      payload: Record<string, unknown>;
    }
  | { type: "error"; code: string };
