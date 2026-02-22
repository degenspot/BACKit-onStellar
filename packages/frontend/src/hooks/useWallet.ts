"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Freighter type shim ────────────────────────────────────────────────────
// Freighter injects `window.freighter` at runtime; these are the methods we use.
declare global {
  interface Window {
    freighter?: {
      isConnected: () => Promise<boolean>;
      getPublicKey: () => Promise<string>;
      signMessage: (
        message: string,
      ) => Promise<{ signedMessage: string; signature: string }>;
      getNetwork: () => Promise<{ network: string; networkPassphrase: string }>;
    };
  }
}

export type WalletState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; publicKey: string; network: string }
  | { status: "error"; message: string };

const STORAGE_KEY = "backit_wallet_pubkey";
const AUTH_TOKEN_KEY = "backit_auth_token";

// ─── Challenge / SIWS helpers ───────────────────────────────────────────────

/**
 * Build a human-readable sign-in challenge that the user signs with Freighter.
 * We include a timestamp so replayed signatures are invalid after TTL.
 */
export function buildChallenge(publicKey: string): string {
  const issuedAt = new Date().toISOString();
  return [
    "BACKit wants you to sign in with your Stellar account:",
    publicKey,
    "",
    "By signing this message you authenticate to BACKit.",
    "This request will not trigger a blockchain transaction or cost any fees.",
    "",
    `Issued At: ${issuedAt}`,
    `Domain: backit.app`,
  ].join("\n");
}

/**
 * Verify a signed challenge on the CLIENT side only.
 * In production you'd POST this to your API and verify server-side with
 * stellar-sdk's `Keypair.fromPublicKey(pk).verify(hash, sig)`.
 *
 * Returns a lightweight JWT-like token we store in sessionStorage.
 */
export function buildAuthToken(publicKey: string, signature: string): string {
  const payload = {
    publicKey,
    signature,
    issuedAt: Date.now(),
    ttl: 86_400_000,
  };
  return btoa(JSON.stringify(payload));
}

export function parseAuthToken(token: string): {
  publicKey: string;
  signature: string;
  issuedAt: number;
  ttl: number;
} | null {
  try {
    return JSON.parse(atob(token));
  } catch {
    return null;
  }
}

export function isTokenValid(token: string): boolean {
  const parsed = parseAuthToken(token);
  if (!parsed) return false;
  return Date.now() - parsed.issuedAt < parsed.ttl;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({ status: "disconnected" });
  const [isFreighterInstalled, setIsFreighterInstalled] = useState<
    boolean | null
  >(null);

  // ── Detect Freighter on mount ──────────────────────────────────────────
  useEffect(() => {
    const detect = async () => {
      // Freighter injects asynchronously; poll briefly then settle
      for (let i = 0; i < 10; i++) {
        if (typeof window !== "undefined" && window.freighter) {
          setIsFreighterInstalled(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      setIsFreighterInstalled(false);
    };
    detect();
  }, []);

  // ── Restore session on mount ───────────────────────────────────────────
  useEffect(() => {
    const restore = async () => {
      const storedKey = localStorage.getItem(STORAGE_KEY);
      const storedToken = sessionStorage.getItem(AUTH_TOKEN_KEY);

      if (!storedKey || !storedToken) return;
      if (!isTokenValid(storedToken)) {
        // Token expired — clear and force re-auth on next connect
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        return;
      }

      // Token still valid: check Freighter is still connected to same key
      try {
        if (!window.freighter) return;
        const connected = await window.freighter.isConnected();
        if (!connected) return;

        const liveKey = await window.freighter.getPublicKey();
        if (liveKey !== storedKey) {
          // Different account — don't silently restore
          localStorage.removeItem(STORAGE_KEY);
          sessionStorage.removeItem(AUTH_TOKEN_KEY);
          return;
        }

        const { network } = await window.freighter.getNetwork();
        setWallet({ status: "connected", publicKey: liveKey, network });
      } catch {
        // Freighter not ready yet; user will need to click Connect
      }
    };

    if (isFreighterInstalled) restore();
  }, [isFreighterInstalled]);

  // ── Connect ────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!window.freighter) {
      setWallet({ status: "error", message: "Freighter not installed" });
      return;
    }

    setWallet({ status: "connecting" });

    try {
      const publicKey = await window.freighter.getPublicKey();
      const { network } = await window.freighter.getNetwork();

      // Sign challenge (SIWS pattern)
      const challenge = buildChallenge(publicKey);
      const { signature } = await window.freighter.signMessage(challenge);

      // Persist
      const token = buildAuthToken(publicKey, signature);
      localStorage.setItem(STORAGE_KEY, publicKey);
      sessionStorage.setItem(AUTH_TOKEN_KEY, token);

      setWallet({ status: "connected", publicKey, network });
    } catch (err: any) {
      const message = err?.message?.includes("User declined")
        ? "Signature declined — please approve in Freighter to sign in."
        : (err?.message ?? "Connection failed");
      setWallet({ status: "error", message });
    }
  }, []);

  // ── Disconnect ─────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    setWallet({ status: "disconnected" });
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────
  const publicKey = wallet.status === "connected" ? wallet.publicKey : null;
  const isConnected = wallet.status === "connected";

  /** Abbreviated address for display: GABCD...WXYZ */
  const shortAddress = publicKey
    ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`
    : null;

  return {
    wallet,
    publicKey,
    isConnected,
    shortAddress,
    isFreighterInstalled,
    connect,
    disconnect,
  };
}
