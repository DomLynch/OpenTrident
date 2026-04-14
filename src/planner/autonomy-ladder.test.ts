import { describe, expect, it } from "vitest";
import {
  getAutonomyLevel,
  canActAutonomously,
  requiresConfirmation,
  getEscalationReason,
  computeNextAutonomyLevel,
} from "./autonomy-ladder.js";

describe("getAutonomyLevel", () => {
  it("returns default for unknown domain", () => {
    expect(getAutonomyLevel("general")).toBe("draft_only");
  });

  it("returns configured level when provided", () => {
    const config = { general: "act_autonomously" as const };
    expect(getAutonomyLevel("general", config)).toBe("act_autonomously");
  });

  it("falls back to default for unknown domain even with partial config", () => {
    const config = { relationship: "read_only" as const };
    expect(getAutonomyLevel("general", config)).toBe("draft_only");
  });

  it("returns act_with_confirmation for relationship domain", () => {
    expect(getAutonomyLevel("relationship")).toBe("act_with_confirmation");
  });

  it("returns draft_only for project domain", () => {
    expect(getAutonomyLevel("project")).toBe("draft_only");
  });
});

describe("canActAutonomously", () => {
  it("returns true for act_autonomously level with any action", () => {
    const config = { general: "act_autonomously" as const };
    expect(canActAutonomously("general", "draft_reply", config)).toBe(true);
    expect(canActAutonomously("general", "send_reply", config)).toBe(true);
  });

  it("returns true for act_with_confirmation with draft_reply", () => {
    const config = { general: "act_with_confirmation" as const };
    expect(canActAutonomously("general", "draft_reply", config)).toBe(true);
  });

  it("returns false for act_with_confirmation with send_reply", () => {
    const config = { general: "act_with_confirmation" as const };
    expect(canActAutonomously("general", "send_reply", config)).toBe(false);
  });

  it("returns true for draft_only with spawn_readonly", () => {
    const config = { general: "draft_only" as const };
    expect(canActAutonomously("general", "spawn_readonly", config)).toBe(true);
  });

  it("returns false for read_only with any write action", () => {
    const config = { general: "read_only" as const };
    expect(canActAutonomously("general", "draft_reply", config)).toBe(false);
    expect(canActAutonomously("general", "send_reply", config)).toBe(false);
  });
});

describe("requiresConfirmation", () => {
  it("always requires confirmation for send_reply", () => {
    expect(requiresConfirmation("general", "send_reply")).toBe(true);
    expect(requiresConfirmation("market", "send_reply")).toBe(true);
  });

  it("requires confirmation for act_with_confirmation level", () => {
    const config = { general: "act_with_confirmation" as const };
    expect(requiresConfirmation("general", "draft_reply", config)).toBe(true);
  });

  it("no confirmation for act_autonomously with spawn_readonly", () => {
    const config = { general: "act_autonomously" as const };
    expect(requiresConfirmation("general", "spawn_readonly", config)).toBe(false);
  });

  it("no confirmation for draft_only with spawn_readonly", () => {
    const config = { general: "draft_only" as const };
    expect(requiresConfirmation("general", "spawn_readonly", config)).toBe(false);
  });
});

describe("getEscalationReason", () => {
  it("returns reason for read_only domain with non-readonly action", () => {
    const config = { general: "read_only" as const };
    expect(getEscalationReason("general", "draft_reply", config)).toBe(
      "general domain is read-only mode",
    );
  });

  it("returns undefined for read_only with spawn_readonly", () => {
    const config = { general: "read_only" as const };
    expect(getEscalationReason("general", "spawn_readonly", config)).toBeUndefined();
  });

  it("returns reason for send_reply when not act_autonomously", () => {
    expect(getEscalationReason("general", "send_reply")).toBe("send_reply requires confirmation");
  });

  it("returns undefined for act_autonomously with send_reply", () => {
    const config = { general: "act_autonomously" as const };
    expect(getEscalationReason("general", "send_reply", config)).toBeUndefined();
  });
});

describe("computeNextAutonomyLevel", () => {
  it("does not change level with fewer than 3 total actions", () => {
    expect(computeNextAutonomyLevel("draft_only", 1, 0, 0)).toBe("draft_only");
    expect(computeNextAutonomyLevel("draft_only", 2, 0, 0)).toBe("draft_only");
  });

  it("promotes level with 90%+ approval and <10% demotion", () => {
    expect(computeNextAutonomyLevel("draft_only", 9, 1, 0)).toBe("act_with_confirmation");
  });

  it("does not promote already at act_autonomously", () => {
    expect(computeNextAutonomyLevel("act_autonomously", 10, 0, 0)).toBe("act_autonomously");
  });

  it("demotes level with 40%+ demotion rate", () => {
    expect(computeNextAutonomyLevel("act_with_confirmation", 4, 3, 0)).toBe("draft_only");
  });

  it("does not demote below read_only", () => {
    expect(computeNextAutonomyLevel("read_only", 0, 5, 0)).toBe("read_only");
  });

  it("stays same with moderate approval rate", () => {
    expect(computeNextAutonomyLevel("draft_only", 5, 3, 2)).toBe("draft_only");
  });

  it("considers modified actions as 0.5 demotion weight", () => {
    expect(computeNextAutonomyLevel("act_with_confirmation", 7, 0, 3)).toBe("draft_only");
  });
});
