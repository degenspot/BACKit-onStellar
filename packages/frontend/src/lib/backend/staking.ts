/**
 * Stake submission client.
 *
 * Mirrors the payout flow: the backend prepares an unsigned Soroban
 * transaction, the wallet signs it, and the relay submits it. Stake state is
 * only ever read back from the indexed backend data, never assumed locally.
 */

import { apiFetch } from "./http";
import { fromStroops } from "./amounts";
import {
  submitSignedTransaction,
  type SignTransaction,
  type SubmitTransactionResponseDto,
} from "./payouts";

export interface PrepareStakeRequestDto {
  userAddress: string;
  side: "YES" | "NO";
  /** Decimal string in stake-asset units — never a float. */
  amount: string;
  comment?: string;
}

export interface PrepareStakeResponseDto {
  xdr: string;
}

/** `POST /calls/:id/stake/prepare` */
export async function prepareStake(
  callId: string,
  request: PrepareStakeRequestDto,
): Promise<PrepareStakeResponseDto> {
  return apiFetch<PrepareStakeResponseDto>(
    `/calls/${encodeURIComponent(callId)}/stake/prepare`,
    { method: "POST", body: request },
  );
}

export interface SubmitStakeParams {
  callId: string;
  userAddress: string;
  side: "YES" | "NO";
  amountStroops: bigint;
  comment?: string;
  signTransaction: SignTransaction;
}

/** Prepare, sign and submit a stake; resolves with the submitted transaction. */
export async function submitStake({
  callId,
  userAddress,
  side,
  amountStroops,
  comment,
  signTransaction,
}: SubmitStakeParams): Promise<SubmitTransactionResponseDto> {
  const prepared = await prepareStake(callId, {
    userAddress,
    side,
    amount: fromStroops(amountStroops),
    ...(comment ? { comment } : {}),
  });
  const signedXdr = await signTransaction(prepared.xdr);
  return submitSignedTransaction(signedXdr);
}
