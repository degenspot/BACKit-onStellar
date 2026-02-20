"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    fetchNotifications,
    markNotificationsRead,
    Notification,
} from "@/lib/api";

const POLL_INTERVAL_MS = 30_000;

export function useNotifications(userId: string | null) {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [load]);

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
