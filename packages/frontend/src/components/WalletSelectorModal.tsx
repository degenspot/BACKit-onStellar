"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { QrCode, X } from "lucide-react";
import {
  buildWalletConnectUri,
  type WalletType,
} from "@/hooks/useWallet";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface WalletOption {
  type: WalletType;
  name: string;
  description: string;
  downloadUrl: string;
  logo: string;
  /** Extension-based wallets need install when not detected; web wallets always selectable. */
  requiresExtension: boolean;
}

export const STELLAR_WALLETS: WalletOption[] = [
  {
    type: "freighter",
    name: "Freighter",
    description: "Browser extension by Stellar Development Foundation",
    downloadUrl: "https://freighter.app",
    logo: "🚀",
    requiresExtension: true,
  },
  {
    type: "lobstr",
    name: "Lobstr",
    description: "Popular Stellar wallet — extension or mobile",
    downloadUrl: "https://lobstr.co/extension",
    logo: "🦞",
    requiresExtension: true,
  },
  {
    type: "albedo",
    name: "Albedo",
    description: "Web-based signer — no install required",
    downloadUrl: "https://albedo.link",
    logo: "✨",
    requiresExtension: false,
  },
  {
    type: "hana",
    name: "Hana",
    description: "Multi-chain wallet with Stellar support",
    downloadUrl: "https://hanawallet.io",
    logo: "🌸",
    requiresExtension: true,
  },
  {
    type: "rabet",
    name: "Rabet",
    description: "Lightweight Stellar browser extension",
    downloadUrl: "https://rabet.io",
    logo: "🦊",
    requiresExtension: true,
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [qrWallet, setQrWallet] = useState<WalletOption | null>(null);

  const qrUri = useMemo(
    () => (qrWallet ? buildWalletConnectUri(qrWallet.type) : null),
    [qrWallet],
  );

  const handleSelect = (wallet: WalletOption) => {
    const installed = installedWallets?.[wallet.type] ?? false;
    if (wallet.requiresExtension && !installed) {
      window.open(wallet.downloadUrl, "_blank", "noopener,noreferrer");
      return;
    }
    onSelect(wallet.type);
    onClose();
  };

  const transition = prefersReducedMotion
    ? {
        enter: "",
        enterFrom: "",
        enterTo: "",
        leave: "",
        leaveFrom: "",
        leaveTo: "",
      }
    : {
        enter: "ease-out duration-200",
        enterFrom: "opacity-0",
        enterTo: "opacity-100",
        leave: "ease-in duration-150",
        leaveFrom: "opacity-100",
        leaveTo: "opacity-0",
      };

  return (
    <Transition show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
        initialFocus={closeButtonRef}
      >
        <Transition.Child as={Fragment} {...transition}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child as={Fragment} {...transition}>
              <Dialog.Panel className="w-full max-w-md rounded-2xl bg-zinc-900 border border-white/10 p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-lg font-semibold text-white">
                    {qrWallet ? `Connect ${qrWallet.name}` : "Connect wallet"}
                  </Dialog.Title>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={() => {
                      if (qrWallet) setQrWallet(null);
                      else onClose();
                    }}
                    className="rounded-lg p-1 text-zinc-400 hover:text-white hover:bg-white/10"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {qrWallet && qrUri ? (
                  <div className="space-y-4 text-center">
                    <p className="text-sm text-zinc-400">
                      Scan with {qrWallet.name} mobile, or open the deep link on
                      this device.
                    </p>
                    <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-xl bg-white p-2">
                      {/* Lightweight QR placeholder — encode URI as data for external QR libs if needed */}
                      <QrCode className="h-24 w-24 text-zinc-900" aria-hidden />
                    </div>
                    <p className="break-all text-xs text-zinc-500 font-mono">{qrUri}</p>
                    <a
                      href={qrUri}
                      className="inline-flex text-sm text-emerald-400 hover:underline"
                    >
                      Open {qrWallet.name}
                    </a>
                    <button
                      type="button"
                      className="block w-full text-sm text-zinc-400 hover:text-white"
                      onClick={() => setQrWallet(null)}
                    >
                      ← Back to wallet list
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {STELLAR_WALLETS.map((wallet) => {
                      const installed =
                        installedWallets?.[wallet.type] ??
                        !wallet.requiresExtension;
                      return (
                        <li key={wallet.type}>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleSelect(wallet)}
                              className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10 transition-colors"
                            >
                              <span className="text-2xl" aria-hidden>
                                {wallet.logo}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-white">
                                  {wallet.name}
                                  {!installed && wallet.requiresExtension && (
                                    <span className="ml-2 text-xs font-normal text-amber-400">
                                      Install
                                    </span>
                                  )}
                                  {installed && wallet.requiresExtension && (
                                    <span className="ml-2 text-xs font-normal text-emerald-400">
                                      Detected
                                    </span>
                                  )}
                                </span>
                                <span className="block text-xs text-zinc-400 truncate">
                                  {wallet.description}
                                </span>
                              </span>
                            </button>
                            {wallet.requiresExtension && (
                              <button
                                type="button"
                                title="Mobile QR / deep link"
                                onClick={() => setQrWallet(wallet)}
                                className="rounded-xl border border-white/10 bg-white/5 px-3 hover:bg-white/10 text-zinc-300"
                                aria-label={`QR connect ${wallet.name}`}
                              >
                                <QrCode className="h-5 w-5" />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
