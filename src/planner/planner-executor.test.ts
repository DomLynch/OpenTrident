import { describe, expect, it } from "vitest";
import { parseApprovalResponse } from "./planner-executor.js";

describe("parseApprovalResponse", () => {
  describe("approval patterns", () => {
    const approvePatterns = [
      "yes", "Yes", "YES",
      "send", "Send", "SEND",
      "send it", "Send it",
      "do it", "Do it",
      "approve", "Approve",
      "go", "Go",
      "y", "Y",
      "confirmed", "Confirmed",
    ];

    for (const pattern of approvePatterns) {
      it(\`recognizes approval: "\${pattern}"\`, () => {
        expect(parseApprovalResponse(pattern)).toEqual({ approved: true });
      });
    }
  });

  describe("rejection patterns", () => {
    const rejectPatterns = [
      "no", "No", "NO",
      "cancel", "Cancel",
      "dont", "don't", "Don't",
      "stop", "Stop",
      "abort", "Abort",
    ];

    for (const pattern of rejectPatterns) {
      it(\`recognizes rejection: "\${pattern}"\`, () => {
        expect(parseApprovalResponse(pattern)).toEqual({ approved: false });
      });
    }
  });

  describe("unrecognized patterns", () => {
    const neutralPatterns = [
      "maybe later",
      "not sure",
      "what do you think",
      "please clarify",
      "",
      "   ",
      "I'll think about it",
    ];

    for (const pattern of neutralPatterns) {
      it(\`returns null for: "\${pattern}"\`, () => {
        expect(parseApprovalResponse(pattern)).toBeNull();
      });
    }
  });
});
