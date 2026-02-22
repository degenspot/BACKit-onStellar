"use client";

import React, { createContext, useContext, useEffect } from "react";
import { useWallet, WalletState } from "./useWallet";
import { useProfile, UserProfile, ProfileSaveStatus } from "./useProfile";

// ─── Context shape ────────────────────────────────────────────────────────────

interface WalletContextValue {
  // Wallet
  wallet: WalletState;
  publicKey: string | null;
  shortAddress: string | null;
  isConnected: boolean;
  isFreighterInstalled: boolean | null;
  connect: () => Promise<void>;
  disconnect: () => void;

  // Profile
  profile: UserProfile | null;
  isProfileLoading: boolean;
  saveStatus: ProfileSaveStatus;
  saveProfile: (
    updates: Partial<Pick<UserProfile, "displayName" | "bio" | "avatarUrl">>,
  ) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const walletHook = useWallet();
  const profileHook = useProfile(walletHook.publicKey);

  // Clear profile data when wallet disconnects
  useEffect(() => {
    if (!walletHook.isConnected) {
      profileHook.clearProfile();
    }
  }, [walletHook.isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: WalletContextValue = {
    // Wallet
    wallet: walletHook.wallet,
    publicKey: walletHook.publicKey,
    shortAddress: walletHook.shortAddress,
    isConnected: walletHook.isConnected,
    isFreighterInstalled: walletHook.isFreighterInstalled,
    connect: walletHook.connect,
    disconnect: walletHook.disconnect,

    // Profile
    profile: profileHook.profile,
    isProfileLoading: profileHook.isLoading,
    saveStatus: profileHook.saveStatus,
    saveProfile: profileHook.saveProfile,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx)
    throw new Error("useWalletContext must be used within <WalletProvider>");
  return ctx;
}
