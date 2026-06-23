"use client";

import { useState, useRef, useEffect } from "react";
import { useWalletContext } from "./WalletContext";
import { WalletSelectorModal } from "./WalletSelectorModal";
import {
  Wallet,
  LogOut,
  ChevronDown,
  Loader2,
  AlertCircle,
  User,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface ConnectButtonProps {
  variant?: "full" | "icon";
  className?: string;
}

export function ConnectButton({ variant = "full", className = "" }: ConnectButtonProps) {
  const {
    wallet,
    shortAddress,
    isConnected,
    installedWallets,
    connect,
    disconnect,
    profile,
  } = useWalletContext();

  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Connecting ─────────────────────────────────────────────────────────────
  if (wallet.status === "connecting") {
    return (
      <button
        disabled
        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium ${className}`}
        style={{ background: "rgba(59,130,246,0.12)", color: "#6b7280", border: "1px solid rgba(59,130,246,0.2)" }}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Signing in…
      </button>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (wallet.status === "error") {
    return (
      <>
        <button
          onClick={() => setModalOpen(true)}
          title={wallet.message}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-80 ${className}`}
          style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <AlertCircle className="w-4 h-4" />
          Retry
        </button>
        <WalletSelectorModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          installedWallets={installedWallets}
          onSelect={connect}
        />
      </>
    );
  }

  // ── Connected ──────────────────────────────────────────────────────────────
  if (isConnected && shortAddress) {
    const displayName = profile?.displayName || shortAddress;
    const network = wallet.status === "connected" ? wallet.network : "MAINNET";
    const isTestnet = network?.toLowerCase().includes("testnet");
    const walletType = wallet.status === "connected" ? wallet.walletType : null;

    return (
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${className}`}
          style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}
        >
          <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
          {variant === "full" && (
            <span className="max-w-[120px] truncate">{displayName}</span>
          )}
          {variant === "icon" && <Wallet className="w-4 h-4" />}
          {isTestnet && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
              TESTNET
            </span>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
        </button>

        {dropdownOpen && (
          <div
            className="absolute right-0 mt-2 w-56 rounded-xl py-1 z-50"
            style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
          >
            <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs text-gray-500 mb-1">
                Connected via {walletType ? walletType.charAt(0).toUpperCase() + walletType.slice(1) : "Wallet"}
              </p>
              <p className="text-xs font-mono text-gray-300 truncate">{shortAddress}</p>
              {isTestnet && <p className="text-[10px] text-amber-400 mt-1">⚠ Testnet — not real funds</p>}
            </div>

            <a
              href={`/profile/${wallet.status === "connected" ? wallet.publicKey : ""}`}
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
              onClick={() => setDropdownOpen(false)}
            >
              <User className="w-4 h-4" />
              My Profile
            </a>

            <button
              onClick={() => { disconnect(); setDropdownOpen(false); }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-white/5 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Disconnected ───────────────────────────────────────────────────────────
  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90 active:scale-95 ${className}`}
        style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)", color: "white", fontFamily: "Bricolage Grotesque, sans-serif" }}
      >
        <Wallet className="w-4 h-4" />
        {t("nav.connectWallet", "Connect Wallet")}
      </button>
      <WalletSelectorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        installedWallets={installedWallets}
        onSelect={connect}
      />
    </>
  );
}
