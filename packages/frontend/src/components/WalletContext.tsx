"use client";

import React, { createContext, useContext, useEffect } from "react";
import { useWallet, WalletState, WalletType } from "../hooks/useWallet";
import { useProfile, UserProfile, ProfileSaveStatus } from "../hooks/useProfile";

interface WalletContextValue {
  // Wallet
  wallet: WalletState;
  publicKey: string | null;
  shortAddress: string | null;
  isConnected: boolean;
  walletType: WalletType | null;
  installedWallets: Record<WalletType, boolean> | null;
  /** @deprecated use installedWallets.freighter */
  isFreighterInstalled: boolean | null;
  connect: (walletType: WalletType) => Promise<void>;
  disconnect: () => void;

  // Profile
  profile: UserProfile | null;
  isProfileLoading: boolean;
  saveStatus: ProfileSaveStatus;
  saveProfile: (updates: Partial<Pick<UserProfile, "displayName" | "bio" | "avatarUrl">>) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const walletHook = useWallet();
  const profileHook = useProfile(walletHook.publicKey);

  useEffect(() => {
    if (!walletHook.isConnected) {
      profileHook.clearProfile();
    }
  }, [walletHook.isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: WalletContextValue = {
    wallet: walletHook.wallet,
    publicKey: walletHook.publicKey,
    shortAddress: walletHook.shortAddress,
    isConnected: walletHook.isConnected,
    walletType: walletHook.walletType,
    installedWallets: walletHook.installedWallets,
    isFreighterInstalled: walletHook.isFreighterInstalled,
    connect: walletHook.connect,
    disconnect: walletHook.disconnect,
    profile: profileHook.profile,
    isProfileLoading: profileHook.isLoading,
    saveStatus: profileHook.saveStatus,
    saveProfile: profileHook.saveProfile,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletContext must be used within <WalletProvider>");
  return ctx;
}
