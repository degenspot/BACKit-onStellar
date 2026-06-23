"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWalletContext } from "./WalletContext";
import { ConnectButton } from "./ConnectButton";
import { NotificationBell } from "./NotificationBell";
import { Search, Keyboard, TrendingUp } from "lucide-react";
import { usePlatformConfig } from "@/contexts/PlatformConfigContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { SearchBar } from "@/components/SearchBar";
import { useTranslation } from "react-i18next";

export function NavBar() {
    const { publicKey } = useWalletContext();
    const { config } = usePlatformConfig();
    const router = useRouter();
    const { t, i18n } = useTranslation();
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

    const handleOpenSearch = useCallback(() => setIsSearchOpen(true), []);
    const handleOpenShortcuts = useCallback(() => setIsShortcutsOpen(true), []);
    const handleCloseUI = useCallback(() => {
        setIsSearchOpen(false);
        setIsShortcutsOpen(false);
    }, []);
    const handleNavigateCreate = useCallback(() => router.push("/create"), [router]);
    const handleNavigateFeed = useCallback(() => router.push("/feed"), [router]);
    const handleNavigateLeaderboard = useCallback(() => router.push("/leaderboard"), [router]);

    useKeyboardShortcuts({
        onOpenSearch: handleOpenSearch,
        onOpenShortcuts: handleOpenShortcuts,
        onNavigateCreate: handleNavigateCreate,
        onNavigateFeed: handleNavigateFeed,
        onNavigateLeaderboard: handleNavigateLeaderboard,
        onCloseUI: handleCloseUI,
    });

    return (
        <>
            <nav
                className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4"
                style={{
                    background: "rgba(8,11,20,0.85)",
                    backdropFilter: "blur(20px)",
                    borderBottom: "1px solid rgba(59,130,246,0.1)",
                }}
            >
                {/* Logo */}
                <div className="flex items-center gap-2">
                    <Link href="/" aria-label="Back to home" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-green-500 to-blue-500">
                            <TrendingUp className="w-4 h-4 text-white" aria-hidden="true" />
                        </div>
                        <span className="font-bold text-lg tracking-tight text-white">
                            BACK<span className="text-green-500">IT</span>
                        </span>
                    </Link>
                </div>

                {/* Search trigger — pill button with shortcut hint */}
                <button
                    type="button"
                    onClick={handleOpenSearch}
                    aria-label="Open search (Cmd+K / Ctrl+K)"
                    className="hidden md:flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-400 transition hover:border-white/20 hover:bg-white/10 hover:text-slate-200"
                >
                    <Search className="h-4 w-4" aria-hidden="true" />
                    <span>Search…</span>
                    <span className="ml-2 flex items-center gap-0.5">
                        <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 text-xs">⌘</kbd>
                        <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 text-xs">K</kbd>
                    </span>
                </button>

                {/* Right-side actions */}
                <div className="flex items-center gap-3">
                    {/* Mobile search icon */}
                    <button
                        type="button"
                        onClick={handleOpenSearch}
                        aria-label="Open search"
                        className="md:hidden rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                    >
                        <Search className="h-5 w-5" aria-hidden="true" />
                    </button>

                    <button
                        type="button"
                        onClick={handleOpenShortcuts}
                        aria-label="Show keyboard shortcuts"
                        className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                    >
                        <Keyboard className="h-5 w-5" aria-hidden="true" />
                    </button>

                    {config && (
                        <div className="text-sm text-gray-300 mr-4">{t('nav.fee', { percent: config.feePercent })}</div>
                    )}
                    <select
                        className="bg-transparent text-slate-200 border border-white/10 rounded-lg p-1 text-sm outline-none cursor-pointer"
                        value={i18n.resolvedLanguage || 'en'}
                        onChange={(e) => i18n.changeLanguage(e.target.value)}
                    >
                        <option value="en" className="bg-[#080b14]">🇺🇸 EN</option>
                        <option value="es" className="bg-[#080b14]">🇪🇸 ES</option>
                    </select>
                    {publicKey && <NotificationBell userId={publicKey} />}
                    <ConnectButton />
                </div>
            </nav>

            <SearchBar open={isSearchOpen} onClose={handleCloseUI} />
            <KeyboardShortcutsModal open={isShortcutsOpen} onClose={handleCloseUI} />
        </>
    );
}
