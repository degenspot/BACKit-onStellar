"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWalletContext } from "./WalletContext";
import { ConnectButton } from "./ConnectButton";
import { NotificationBell } from "./NotificationBell";
import { Keyboard, TrendingUp } from "lucide-react";
import { usePlatformConfig } from "@/contexts/PlatformConfigContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { SearchBar } from "./SearchBar";

export function NavBar() {
    const { publicKey } = useWalletContext();
    const { config } = usePlatformConfig();
    const router = useRouter();
    const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

    const handleOpenShortcuts = useCallback(() => setIsShortcutsOpen(true), []);
    const handleCloseUI = useCallback(() => {
        setIsShortcutsOpen(false);
    }, []);
    const handleNavigateCreate = useCallback(() => router.push("/create"), [router]);
    const handleNavigateFeed = useCallback(() => router.push("/feed"), [router]);
    const handleNavigateLeaderboard = useCallback(() => router.push("/leaderboard"), [router]);

    useKeyboardShortcuts({
        onOpenSearch: () => {}, // Managed internally by SearchBar
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
                <div className="flex items-center gap-2">
                    <Link href="/" aria-label="Back to home" className="flex items-center gap-2">
                        <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-green-500 to-blue-500"
                        >
                            <TrendingUp className="w-4 h-4 text-white" aria-hidden="true" />
                        </div>
                        <span className="font-bold text-lg tracking-tight text-white">
                            BACK<span className="text-green-500">IT</span>
                        </span>
                    </Link>
                </div>

                <div className="hidden md:block flex-1 max-w-md mx-8">
                    <SearchBar />
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handleOpenShortcuts}
                        aria-label="Show keyboard shortcuts"
                        className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                    >
                        <Keyboard className="h-5 w-5" aria-hidden="true" />
                    </button>
                    {config && (
                        <div className="text-sm text-gray-300 mr-4">Fee: {config.feePercent}%</div>
                    )}
                    {publicKey && <NotificationBell userId={publicKey} />}
                    <ConnectButton />
                </div>
            </nav>
            <KeyboardShortcutsModal open={isShortcutsOpen} onClose={handleCloseUI} />
        </>
    );
}
