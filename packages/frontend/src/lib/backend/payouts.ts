/**
 * Payout claim client.
 *
 * The claim is a two-step, wallet-signed flow — the frontend never mutates
 * claim state on its own:
 *   1. `POST /calls/:id/claim/prepare` returns an unsigned Soroban XDR
 *   2. the connected wallet signs it
 *   3. `POST /relay/tx` submits the signed XDR and returns the tx hash
 *
 * The backend records the claim from the on-chain event, so a successful
 * submission is reflected by re-reading `GET /users/:address/payouts`.
 */

import { apiFetch } from "./http";

export interface PrepareClaimRequestDto {
  /** Wallet claiming the payout. */
  userAddress: string;
}

export interface PrepareClaimResponseDto {
  /** Unsigned transaction envelope. */
  xdr: string;
  /** Expected payout as a decimal string, when the backend can compute it. */
  amount?: string;
}

export interface SubmitTransactionResponseDto {
  hash: string;
  status?: string;
}

/** Step 1 — ask the backend for the unsigned claim transaction. */
export async function prepareClaim(
  callId: string,
  userAddress: string,
): Promise<PrepareClaimResponseDto> {
  return apiFetch<PrepareClaimResponseDto>(
    `/calls/${encodeURIComponent(callId)}/claim/prepare`,
    { method: "POST", body: { userAddress } satisfies PrepareClaimRequestDto },
  );
}

/** Step 3 — submit the wallet-signed envelope through the relay. */
export async function submitSignedTransaction(
  signedXdr: string,
): Promise<SubmitTransactionResponseDto> {
  return apiFetch<SubmitTransactionResponseDto>("/relay/tx", {
    method: "POST",
    body: { xdr: signedXdr },
    // Submission waits on network inclusion, so allow more time than a read.
    timeoutMs: 30_000,
  });
}

export type SignTransaction = (xdr: string) => Promise<string>;

export interface ClaimResult {
  hash: string;
  /** Amount reported by the prepare step, when available. */
  amount?: string;
}

/**
 * Run the full prepare → sign → submit flow.
 *
 * Errors from any step propagate untouched so the UI can distinguish a
 * rejected signature from a backend or network failure.
 */
export async function claimPayout(
  callId: string,
  userAddress: string,
  signTransaction: SignTransaction,
): Promise<ClaimResult> {
  const prepared = await prepareClaim(callId, userAddress);
  const signedXdr = await signTransaction(prepared.xdr);
  const submitted = await submitSignedTransaction(signedXdr);
  return {
    hash: submitted.hash,
    ...(prepared.amount ? { amount: prepared.amount } : {}),
  };
}
