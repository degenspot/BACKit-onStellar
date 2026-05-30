"use client";

import { X } from "lucide-react";
import { WalletType } from "@/hooks/useWallet";

interface WalletOption {
  type: WalletType;
  name: string;
  description: string;
  downloadUrl: string;
  logo: string; // emoji or URL
}

const WALLETS: WalletOption[] = [
  {
    type: "freighter",
    name: "Freighter",
    description: "Browser extension by Stellar Development Foundation",
    downloadUrl: "https://freighter.app",
    logo: "🚀",
  },
  {
    type: "lobstr",
    name: "Lobstr",
    description: "Popular Stellar wallet with browser extension",
    downloadUrl: "https://lobstr.co/extension",
    logo: "🦞",
  },
  {
    type: "albedo",
    name: "Albedo",
    description: "Web-based signer — no install required",
    downloadUrl: "https://albedo.link",
    logo: "✨",
  },
];

interface WalletSelectorModalProps {
  open: boolean;
  onClose: () => void;
  installedWallets: Record<WalletType, boolean> | null;
  onSelect: (walletType: WalletType) => void;
}

export function WalletSelectorModal({
  open,
  onClose,
  installedWallets,
  onSelect,
}: WalletSelectorModalProps) {
  if (!open) return null;

  const handleSelect = (wallet: WalletOption) => {
    const installed = installedWallets?.[wallet.type] ?? false;
    if (!installed && wallet.type !== "albedo") {
      window.open(wallet.downloadUrl, "_blank", "noopener,noreferrer");
      return;
    }
    onSelect(wallet.type);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{
          background: "#0d1117",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">Connect Wallet</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wallet options */}
        <div className="flex flex-col gap-3">
          {WALLETS.map((wallet) => {
            const installed = installedWallets?.[wallet.type] ?? false;
            const available = installed || wallet.type === "albedo";

            return (
              <button
                key={wallet.type}
                onClick={() => handleSelect(wallet)}
                className="flex items-center gap-4 p-4 rounded-xl text-left transition-all hover:bg-white/5"
                style={{ border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <span className="text-2xl w-10 text-center" aria-hidden="true">
                  {wallet.logo}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{wallet.name}</p>
                  <p className="text-xs text-gray-500 truncate">{wallet.description}</p>
                </div>
                <span
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
                  style={
                    available
                      ? { background: "rgba(34,197,94,0.12)", color: "#22c55e" }
                      : { background: "rgba(107,114,128,0.15)", color: "#6b7280" }
                  }
                >
                  {wallet.type === "albedo" ? "Web" : installed ? "Installed" : "Not Installed"}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-gray-600 text-center mt-5">
          By connecting, you agree to sign a message to authenticate.
        </p>
      </div>
    </div>
  );
}
