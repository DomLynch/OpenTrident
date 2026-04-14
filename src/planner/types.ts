export type PlannerIntent = "signal" | "attention" | "goal" | "task" | "result" | "escalation";

export type PlannerEnvelope = {
  from: string;
  to: string;
  intent: PlannerIntent;
  thread?: string;
  replyTo?: string;
  body: string;
  evidence?: string[];
  metadata?: Record<string, unknown>;
};

export type PlannerDomain = "general" | "relationship" | "project" | "market" | "decision";

export type PlannerActionClass =
  | "surface_only"
  | "spawn_readonly"
  | "draft_reply"
  | "draft_issue"
  | "brief"
  | "send_reply";

export type PlannerItem = {
  id: string;
  intent: PlannerIntent;
  domain: PlannerDomain;
  score: number;
  summary: string;
  evidence: string[];
  source: string;
  envelope: PlannerEnvelope;
};

export type PlannerGoal = {
  id: string;
  title: string;
  summary: string;
  actionClass: PlannerActionClass;
  domain: PlannerDomain;
  sourceItemId: string;
};

export type PlannerDecisionMode = "idle" | "surface" | "spawn_readonly" | "send";

export type PlannerDecision = {
  mode: PlannerDecisionMode;
  topItem?: PlannerItem;
  goal?: PlannerGoal;
  candidates: PlannerItem[];
  promptBlock?: string;
};

export type PlannerStateStatus =
  | "candidate"
  | "selected"
  | "spawned"
  | "running"
  | "done"
  | "failed"
  | "blocked"
  | "escalated"
  | "dropped"
  | "awaiting_confirmation"
  | "approved"
  | "rejected"
  | "modified";

export type PlannerStateRow = {
  id: string;
  sessionKey: string;
  status: PlannerStateStatus;
  mode: PlannerDecisionMode;
  title: string;
  summary: string;
  domain: PlannerDomain;
  actionClass: PlannerActionClass;
  sourceItemId: string;
  score: number;
  createdAt: number;
  updatedAt: number;
  evidence?: string[];
  childSessionKey?: string;
  runId?: string;
  note?: string;
  draftResult?: string;
  confirmationToken?: string;
  confirmedAt?: number;
  sentAt?: number;
};
