"use client";

import Link from "next/link";
import { useWalletContext } from "./WalletContext";
import { ConnectButton } from "./ConnectButton";
import { NotificationBell } from "./NotificationBell";
import { TrendingUp } from "lucide-react";

export function NavBar() {
    const { publicKey } = useWalletContext();

    return (
        <nav
            className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4"
            style={{
                background: "rgba(8,11,20,0.85)",
                backdropFilter: "blur(20px)",
                borderBottom: "1px solid rgba(59,130,246,0.1)",
            }}
        >
            <div className="flex items-center gap-2">
                <Link href="/" className="flex items-center gap-2">
                    <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-green-500 to-blue-500"
                    >
                        <TrendingUp className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-bold text-lg tracking-tight text-white">
                        BACK<span className="text-green-500">IT</span>
                    </span>
                </Link>
            </div>

            <div className="flex items-center gap-4">
                {publicKey && <NotificationBell userId={publicKey} />}
                <ConnectButton />
            </div>
        </nav>
    );
}
