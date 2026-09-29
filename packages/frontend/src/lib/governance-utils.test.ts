import { describe, expect, it } from "vitest";
import {
  quorumProgress,
  supportToContractValue,
  totalVotes,
} from "./governance-utils";

describe("governance-utils (#599)", () => {
  it("computes quorum progress", () => {
    const tally = { forVotes: 800, againstVotes: 200, abstainVotes: 0 };
    const q = quorumProgress(tally, {
      quorumFraction: 0.1,
      totalVotingPower: 10_000,
    });
    expect(totalVotes(tally)).toBe(1000);
    expect(q.needed).toBe(1000);
    expect(q.reached).toBe(true);
    expect(q.percent).toBe(100);
  });

  it("maps support to contract values", () => {
    expect(supportToContractValue("against")).toBe(0);
    expect(supportToContractValue("for")).toBe(1);
    expect(supportToContractValue("abstain")).toBe(2);
  });
});
