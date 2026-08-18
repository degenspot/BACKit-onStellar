"use client";

import { signWithFreighter } from "./freighter";
import type { WalletType } from "@/hooks/useWallet";

/** Raised when the connected wallet cannot sign transactions. */
export class UnsupportedWalletError extends Error {
  constructor(walletType: WalletType | null) {
    super(
      walletType
        ? `${walletType} cannot sign transactions in this app yet`
        : "Connect a wallet to sign this transaction",
    );
    this.name = "UnsupportedWalletError";
  }
}

/**
 * Sign a transaction envelope with the connected wallet and return the signed
 * XDR. Wallet rejections propagate so callers can show a distinct message.
 */
export async function signTransactionWithWallet(
  walletType: WalletType | null,
  xdr: string,
): Promise<string> {
  if (walletType === "freighter") {
    const signed = await signWithFreighter(xdr);
    // freighter-api v1 returns a string; v2+ returns { signedTxXdr }.
    return typeof signed === "string"
      ? signed
      : ((signed as { signedTxXdr?: string }).signedTxXdr ?? "");
  }

  if (walletType === "lobstr") {
    if (typeof window === "undefined" || !window.lobstr) {
      throw new UnsupportedWalletError("lobstr");
    }
    const result = await window.lobstr.signTransaction(xdr);
    return result.signedXDR;
  }

  throw new UnsupportedWalletError(walletType);
}
