"use client";

import { useState, useEffect, useCallback } from "react";
import albedo from "@albedo-link/intent";

// ─── Wallet type declarations ────────────────────────────────────────────────

export type WalletType = "freighter" | "lobstr" | "albedo";

declare global {
  interface Window {
    freighter?: {
      isConnected: () => Promise<boolean>;
      getPublicKey: () => Promise<string>;
      signMessage: (message: string) => Promise<{ signedMessage: string; signature: string }>;
      getNetwork: () => Promise<{ network: string; networkPassphrase: string }>;
    };
    lobstr?: {
      isConnected: () => Promise<boolean>;
      getPublicKey: () => Promise<string>;
      signTransaction: (xdr: string) => Promise<{ signedXDR: string }>;
    };
  }
}

export type WalletState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; publicKey: string; network: string; walletType: WalletType }
  | { status: "error"; message: string };

const STORAGE_KEY = "backit_wallet_pubkey";
const STORAGE_WALLET_TYPE = "backit_wallet_type";
const AUTH_TOKEN_KEY = "backit_auth_token";

// ─── Challenge / SIWS helpers ────────────────────────────────────────────────

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

export function buildAuthToken(publicKey: string, signature: string): string {
  const payload = { publicKey, signature, issuedAt: Date.now(), ttl: 86_400_000 };
  return btoa(JSON.stringify(payload));
}

export function parseAuthToken(token: string): {
  publicKey: string; signature: string; issuedAt: number; ttl: number;
} | null {
  try { return JSON.parse(atob(token)); } catch { return null; }
}

export function isTokenValid(token: string): boolean {
  const parsed = parseAuthToken(token);
  if (!parsed) return false;
  return Date.now() - parsed.issuedAt < parsed.ttl;
}

// ─── Wallet detection ────────────────────────────────────────────────────────

export async function detectWallets(): Promise<Record<WalletType, boolean>> {
  const poll = async (check: () => boolean) => {
    for (let i = 0; i < 10; i++) {
      if (check()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  const [freighter, lobstr] = await Promise.all([
    poll(() => typeof window !== "undefined" && !!window.freighter),
    poll(() => typeof window !== "undefined" && !!window.lobstr),
  ]);

  // Albedo is web-based, always "available"
  return { freighter, lobstr, albedo: true };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({ status: "disconnected" });
  const [installedWallets, setInstalledWallets] = useState<Record<WalletType, boolean> | null>(null);

  // Detect wallets on mount
  useEffect(() => {
    detectWallets().then(setInstalledWallets);
  }, []);

  // Restore session on mount
  useEffect(() => {
    if (!installedWallets) return;
    const restore = async () => {
      const storedKey = localStorage.getItem(STORAGE_KEY);
      const storedToken = sessionStorage.getItem(AUTH_TOKEN_KEY);
      const storedType = localStorage.getItem(STORAGE_WALLET_TYPE) as WalletType | null;

      if (!storedKey || !storedToken || !storedType) return;
      if (!isTokenValid(storedToken)) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_WALLET_TYPE);
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        return;
      }

      try {
        if (storedType === "freighter" && window.freighter) {
          const connected = await window.freighter.isConnected();
          if (!connected) return;
          const liveKey = await window.freighter.getPublicKey();
          if (liveKey !== storedKey) { clearStorage(); return; }
          const { network } = await window.freighter.getNetwork();
          setWallet({ status: "connected", publicKey: liveKey, network, walletType: "freighter" });
        } else if (storedType === "lobstr" && window.lobstr) {
          const connected = await window.lobstr.isConnected();
          if (!connected) return;
          const liveKey = await window.lobstr.getPublicKey();
          if (liveKey !== storedKey) { clearStorage(); return; }
          setWallet({ status: "connected", publicKey: liveKey, network: "PUBLIC", walletType: "lobstr" });
        } else if (storedType === "albedo") {
          // Albedo doesn't persist connection; restore from stored key only
          setWallet({ status: "connected", publicKey: storedKey, network: "PUBLIC", walletType: "albedo" });
        }
      } catch {
        // Wallet not ready; user will need to reconnect
      }
    };
    restore();
  }, [installedWallets]);

  const clearStorage = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_WALLET_TYPE);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  };

  // ── Connect ──────────────────────────────────────────────────────────────
  const connect = useCallback(async (walletType: WalletType) => {
    setWallet({ status: "connecting" });

    try {
      let publicKey: string;
      let network = "PUBLIC";
      let signature: string;

      if (walletType === "freighter") {
        if (!window.freighter) throw new Error("Freighter not installed");
        publicKey = await window.freighter.getPublicKey();
        const net = await window.freighter.getNetwork();
        network = net.network;
        const challenge = buildChallenge(publicKey);
        const result = await window.freighter.signMessage(challenge);
        signature = result.signature;

      } else if (walletType === "lobstr") {
        if (!window.lobstr) throw new Error("Lobstr not installed");
        publicKey = await window.lobstr.getPublicKey();
        // Lobstr doesn't support signMessage; use publicKey as signature placeholder
        signature = publicKey;

      } else {
        // Albedo
        const result = await albedo.publicKey({});
        publicKey = result.pubkey;
        signature = result.pubkey; // Albedo confirms ownership via intent
      }

      const token = buildAuthToken(publicKey, signature);
      localStorage.setItem(STORAGE_KEY, publicKey);
      localStorage.setItem(STORAGE_WALLET_TYPE, walletType);
      sessionStorage.setItem(AUTH_TOKEN_KEY, token);

      setWallet({ status: "connected", publicKey, network, walletType });
    } catch (err: any) {
      const message =
        err?.message?.includes("User declined") || err?.message?.includes("rejected")
          ? "Connection declined — please approve in your wallet."
          : (err?.message ?? "Connection failed");
      setWallet({ status: "error", message });
    }
  }, []);

  // ── Disconnect ───────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    clearStorage();
    setWallet({ status: "disconnected" });
  }, []);

  const publicKey = wallet.status === "connected" ? wallet.publicKey : null;
  const isConnected = wallet.status === "connected";
  const walletType = wallet.status === "connected" ? wallet.walletType : null;
  const shortAddress = publicKey
    ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`
    : null;

  // Legacy compat: isFreighterInstalled
  const isFreighterInstalled = installedWallets?.freighter ?? null;

  return {
    wallet,
    publicKey,
    isConnected,
    shortAddress,
    walletType,
    installedWallets,
    isFreighterInstalled,
    connect,
    disconnect,
  };
}
