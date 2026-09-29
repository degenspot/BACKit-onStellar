"use client";

import { Fragment, useRef } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X } from "lucide-react";
import { useGovernance } from "@/hooks/useGovernance";
import type { VoteSupport } from "@/lib/governance-utils";
import { isVotingOpen, totalVotes } from "@/lib/governance-utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface Props {
  open: boolean;
  onClose: () => void;
  proposalId: string;
  onSignVote?: (xdrOrHint: string) => Promise<void>;
}

export function GovernanceVotingModal({
  open,
  onClose,
  proposalId,
  onSignVote,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const {
    proposal,
    loading,
    error,
    quorumPercent,
    quorumReached,
    castVote,
    voting,
  } = useGovernance(proposalId, onSignVote);

  const transition = prefersReducedMotion
    ? { enter: "", enterFrom: "", enterTo: "", leave: "", leaveFrom: "", leaveTo: "" }
    : {
        enter: "ease-out duration-200",
        enterFrom: "opacity-0",
        enterTo: "opacity-100",
        leave: "ease-in duration-150",
        leaveFrom: "opacity-100",
        leaveTo: "opacity-0",
      };

  const handleVote = async (support: VoteSupport) => {
    await castVote(support);
  };

  return (
    <Transition show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose} initialFocus={closeRef}>
        <Transition.Child as={Fragment} {...transition}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child as={Fragment} {...transition}>
              <Dialog.Panel className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-white/10 p-6 shadow-xl space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <Dialog.Title className="text-lg font-semibold text-white">
                    {proposal?.title ?? "Governance proposal"}
                  </Dialog.Title>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1 text-zinc-400 hover:text-white hover:bg-white/10"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {loading && (
                  <p className="text-sm text-zinc-400">Loading proposal…</p>
                )}
                {error && (
                  <p className="text-sm text-red-400" role="alert">
                    {error}
                  </p>
                )}

                {proposal && (
                  <>
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                      {proposal.description}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Voting{" "}
                      {isVotingOpen(proposal.startsAt, proposal.endsAt)
                        ? "open"
                        : "closed"}{" "}
                      · ends {new Date(proposal.endsAt).toLocaleString()}
                    </p>

                    {/* Quorum bar */}
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-1">
                        <span>Quorum</span>
                        <span>
                          {quorumPercent}%
                          {quorumReached ? " — reached" : " — not reached"}
                        </span>
                      </div>
                      <div
                        className="h-2 rounded-full bg-zinc-800 overflow-hidden"
                        role="progressbar"
                        aria-valuenow={quorumPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className={`h-full transition-all ${
                            quorumReached ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                          style={{ width: `${Math.min(100, quorumPercent)}%` }}
                        />
                      </div>
                    </div>

                    {/* Tally */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-emerald-500/10 p-2">
                        <div className="text-emerald-400 font-semibold">
                          {proposal.tally.forVotes.toLocaleString()}
                        </div>
                        <div className="text-zinc-400">For</div>
                      </div>
                      <div className="rounded-lg bg-red-500/10 p-2">
                        <div className="text-red-400 font-semibold">
                          {proposal.tally.againstVotes.toLocaleString()}
                        </div>
                        <div className="text-zinc-400">Against</div>
                      </div>
                      <div className="rounded-lg bg-zinc-500/10 p-2">
                        <div className="text-zinc-300 font-semibold">
                          {proposal.tally.abstainVotes.toLocaleString()}
                        </div>
                        <div className="text-zinc-400">Abstain</div>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500 text-center">
                      {totalVotes(proposal.tally).toLocaleString()} votes cast
                    </p>

                    {isVotingOpen(proposal.startsAt, proposal.endsAt) && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {(
                          [
                            ["for", "Vote For"],
                            ["against", "Vote Against"],
                            ["abstain", "Abstain"],
                          ] as const
                        ).map(([support, label]) => (
                          <button
                            key={support}
                            type="button"
                            disabled={voting}
                            onClick={() => void handleVote(support)}
                            className="flex-1 min-w-[6rem] rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 px-3 py-2 text-sm font-medium text-white"
                          >
                            {voting ? "Signing…" : label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
