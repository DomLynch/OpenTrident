export type SessionEntry = {
  updatedAt: number;
  lastChannel?: string;
  lastTo?: string;
  lastHeartbeatText?: string;
  lastHeartbeatSentAt?: number;
  deliveryContext?: Record<string, unknown>;
  lastAccountId?: string;
  lastThreadId?: string | number;
};
