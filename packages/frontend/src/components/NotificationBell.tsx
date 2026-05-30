"use client";

import { useRef, useState, useEffect } from "react";
import "./notification-animations.css";
import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationItem } from "./NotificationItem";

interface Props {
    userId: string | null;
}

export function NotificationBell({ userId }: Props) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { notifications, unreadCount, markRead } = useNotifications(userId);
    const [animateIds, setAnimateIds] = useState<number[]>([]);
    const animatedIdsRef = useRef<Set<number>>(new Set());

    // Animate new notifications
    useEffect(() => {
        if (notifications.length === 0) return;
        const latestId = notifications[0].id;
        if (animatedIdsRef.current.has(latestId)) return;

        animatedIdsRef.current.add(latestId);
        setAnimateIds((prev) => [latestId, ...prev].slice(0, 10));
        const timeoutId = window.setTimeout(() => {
            setAnimateIds((prev) => prev.filter((id) => id !== latestId));
            animatedIdsRef.current.delete(latestId);
        }, 1200);

        return () => window.clearTimeout(timeoutId);
    }, [notifications]);

    const handleMarkAllRead = async () => {
        await markRead();
    };

    const handleMarkOneRead = async (id: number) => {
        await markRead([id]);
    };

    return (
        <div className="relative" ref={containerRef}>
            {/* Bell button */}
            <button
                onClick={() => setOpen((o) => !o)}
                className="relative p-2 rounded-full text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Notifications"
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {open && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOpen(false)}
                    />
                    <div className="absolute right-0 z-50 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <h3 className="text-sm font-semibold text-gray-900">
                                Notifications
                            </h3>
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAllRead}
                                    className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                                >
                                    Mark all read
                                </button>
                            )}
                        </div>

                        {/* List */}
                        <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
                            {notifications.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                                    <Bell className="w-8 h-8 mb-2 opacity-40" />
                                    <p className="text-sm">No notifications yet</p>
                                </div>
                            ) : (
                                notifications.map((n) => (
                                    <div
                                        key={n.id}
                                        className={animateIds.includes(n.id) ? "animate-fade-in" : ""}
                                    >
                                        <NotificationItem
                                            notification={n}
                                            onMarkRead={handleMarkOneRead}
                                        />
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
