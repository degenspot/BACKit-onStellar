/**
 * Governance proposal math & types (#599).
 */

export type VoteSupport = "for" | "against" | "abstain";

export interface ProposalTally {
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
}

export interface QuorumConfig {
  /** Minimum participation (for+against+abstain) as fraction of total voting power, 0–1 */
  quorumFraction: number;
  totalVotingPower: number;
}

export function totalVotes(tally: ProposalTally): number {
  return tally.forVotes + tally.againstVotes + tally.abstainVotes;
}

export function quorumProgress(
  tally: ProposalTally,
  config: QuorumConfig,
): { reached: boolean; percent: number; needed: number } {
  const cast = totalVotes(tally);
  const needed = config.quorumFraction * config.totalVotingPower;
  const percent =
    needed <= 0 ? 100 : Math.min(100, Math.round((cast / needed) * 1000) / 10);
  return { reached: cast >= needed, percent, needed };
}

export function supportToContractValue(support: VoteSupport): number {
  if (support === "for") return 1;
  if (support === "against") return 0;
  return 2; // abstain
}

export function isVotingOpen(startsAt: number, endsAt: number, now = Date.now()): boolean {
  return now >= startsAt && now <= endsAt;
}
