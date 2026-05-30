"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    fetchNotifications,
    markNotificationsRead,
    Notification,
} from "@/lib/api";

const POLL_INTERVAL_MS = 30_000;

let socket: WebSocket | null = null;

export function useNotifications(userId: string | null) {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const firstLoad = useRef(true);

    const load = useCallback(async () => {
        if (!userId) return;
        try {
            const res = await fetchNotifications(userId, 20, 0);
            setNotifications(res.data);
            setUnreadCount(res.unreadCount);
        } catch {
            // silently fail — non-critical
        }
    }, [userId]);

    useEffect(() => {
        setLoading(true);
        load().finally(() => setLoading(false));

        intervalRef.current = setInterval(() => {
            load();
        }, POLL_INTERVAL_MS);

        // WebSocket setup
        if (userId) {
            // Close previous socket if any
            if (socket) {
                socket.close();
            }
            // Use the backend ws endpoint
            const wsUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000").replace(/^http/, "ws") + "/ws";
            socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                // Subscribe to user notifications (JWT not handled here, demo only)
                // In production, send JWT if required
                socket?.send(JSON.stringify({ event: "user:subscribe", data: { userId } }));
            };

            socket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    // Listen for user notifications
                    if (msg.event === "user:notification" && msg.data) {
                        setNotifications((prev) => [msg.data, ...prev]);
                        setUnreadCount((prev) => prev + 1);
                    }
                } catch {}
            };

            socket.onerror = () => {
                // Optionally handle errors
            };
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (socket) {
                socket.close();
                socket = null;
            }
        };
    }, [load, userId]);

    const markRead = useCallback(
        async (ids?: number[]) => {
            if (!userId) return;
            await markNotificationsRead(userId, ids);
            setNotifications((prev) =>
                prev.map((n) =>
                    !ids || ids.includes(n.id) ? { ...n, readStatus: true } : n
                )
            );
            setUnreadCount((prev) =>
                ids ? Math.max(0, prev - ids.length) : 0
            );
        },
        [userId]
    );

    return { notifications, unreadCount, loading, markRead, refresh: load };
}
