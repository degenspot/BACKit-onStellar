"use client";

import { useCallback, useEffect, useState } from "react";
import {
  quorumProgress,
  type ProposalTally,
  type QuorumConfig,
  type VoteSupport,
  supportToContractValue,
} from "@/lib/governance-utils";

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number;
  tally: ProposalTally;
  quorum: QuorumConfig;
  status: "active" | "passed" | "rejected" | "pending";
}

export interface UseGovernanceResult {
  proposal: GovernanceProposal | null;
  loading: boolean;
  error: string | null;
  quorumPercent: number;
  quorumReached: boolean;
  castVote: (support: VoteSupport) => Promise<void>;
  voting: boolean;
  refresh: () => Promise<void>;
}

async function fetchProposal(id: string): Promise<GovernanceProposal> {
  const res = await fetch(`/api/governance/proposals/${encodeURIComponent(id)}`);
  if (!res.ok) {
    // Demo fallback for local UI development
    return {
      id,
      title: "Update market protocol fee",
      description:
        "Reduce the protocol fee from 2% to 1.5% for all prediction markets.",
      startsAt: Date.now() - 86_400_000,
      endsAt: Date.now() + 3 * 86_400_000,
      tally: { forVotes: 1200, againstVotes: 400, abstainVotes: 100 },
      quorum: { quorumFraction: 0.1, totalVotingPower: 20_000 },
      status: "active",
    };
  }
  return res.json();
}

/**
 * Loads a governance proposal and submits `cast_vote(proposal_id, support)`.
 */
export function useGovernance(
  proposalId: string,
  signAndSubmit?: (xdrHint: string) => Promise<void>,
): UseGovernanceResult {
  const [proposal, setProposal] = useState<GovernanceProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await fetchProposal(proposalId);
      setProposal(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load proposal");
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const progress = proposal
    ? quorumProgress(proposal.tally, proposal.quorum)
    : { percent: 0, reached: false };

  const castVote = useCallback(
    async (support: VoteSupport) => {
      setVoting(true);
      setError(null);
      try {
        const value = supportToContractValue(support);
        const res = await fetch(
          `/api/governance/proposals/${encodeURIComponent(proposalId)}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ support: value }),
          },
        );
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.xdr && signAndSubmit) {
            await signAndSubmit(body.xdr);
          }
        } else if (signAndSubmit) {
          // Local/demo: still invoke wallet with a placeholder instruction
          await signAndSubmit(`cast_vote:${proposalId}:${value}`);
        } else if (!res.ok) {
          throw new Error(`Vote failed (${res.status})`);
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Vote failed");
        throw e;
      } finally {
        setVoting(false);
      }
    },
    [proposalId, refresh, signAndSubmit],
  );

  return {
    proposal,
    loading,
    error,
    quorumPercent: progress.percent,
    quorumReached: progress.reached,
    castVote,
    voting,
    refresh,
  };
}
