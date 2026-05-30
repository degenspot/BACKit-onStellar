"use client";

import { useState } from "react";

export interface OptimisticStake {
  id: string;
  side: "yes" | "no";
  amount: number;
  pending: boolean;
}

interface UseOptimisticStakingResult {
  stakes: OptimisticStake[];
  addOptimisticStake: (side: "yes" | "no", amount: number, txFn: () => Promise<void>) => Promise<void>;
  error: string | null;
}

/**
 * Hook that manages optimistic stake updates.
 * Immediately adds the stake as "pending", then confirms or reverts
 * based on the transaction result.
 */
export function useOptimisticStaking(initialStakes: OptimisticStake[] = []): UseOptimisticStakingResult {
  const [stakes, setStakes] = useState<OptimisticStake[]>(initialStakes);
  const [error, setError] = useState<string | null>(null);

  const addOptimisticStake = async (side: "yes" | "no", amount: number, txFn: () => Promise<void>) => {
    const id = `optimistic-${Date.now()}`;
    const optimistic: OptimisticStake = { id, side, amount, pending: true };

    // Optimistically add
    setStakes((prev) => [...prev, optimistic]);
    setError(null);

    try {
      await txFn();
      // Confirm — remove pending flag
      setStakes((prev) => prev.map((s) => s.id === id ? { ...s, pending: false } : s));
    } catch (err) {
      // Revert
      setStakes((prev) => prev.filter((s) => s.id !== id));
      setError(err instanceof Error ? err.message : "Transaction failed");
    }
  };

  return { stakes, addOptimisticStake, error };
}