"use client";

import { useEffect, useRef, useState } from "react";
import { useSocket } from "@/contexts/WebSocketContext";
import { amountFromApi, formatAmount, type MarketStake } from "@/lib/backend";

const PAGE_SIZE = 10;

function timeAgo(timestamp: string) {
  const s = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

interface Props {
  /** Recent stakes loaded from the backend, newest first. */
  stakes: MarketStake[];
  callId: string;
  stakeToken: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function ActivityLog({
  stakes,
  callId,
  stakeToken,
  loading = false,
  error = null,
  onRetry,
}: Props) {
  const [entries, setEntries] = useState<MarketStake[]>(stakes);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const seenTxHashes = useRef<Set<string>>(new Set());
  const { status, send } = useSocket();

  // Keep the log in sync with the backend-loaded page of stakes.
  useEffect(() => {
    setEntries(stakes);
    seenTxHashes.current = new Set(stakes.map((s) => s.txHash));
  }, [stakes]);

  // Subscribe to call-specific stake events when connected
  useEffect(() => {
    if (status === "connected") {
      send(JSON.stringify({ event: "call:subscribe", data: { callId } }));
    }
  }, [status, callId, send]);

  // Listen for real-time stake events via window message relay from WebSocketContext
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      try {
        const msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (msg.event !== "call:stake" || String(msg.data?.callId) !== callId) {
          return;
        }
        const raw = msg.data.stake as {
          address?: string;
          userAddress?: string;
          side?: "YES" | "NO";
          position?: "YES" | "NO";
          amount?: string | number;
          timestamp?: string;
          createdAt?: string;
          txHash?: string;
          transactionHash?: string;
          comment?: string;
        };
        const txHash = raw.txHash ?? raw.transactionHash;
        if (!txHash || seenTxHashes.current.has(txHash)) return;

        const incoming: MarketStake = {
          address: raw.address ?? raw.userAddress ?? "",
          side: raw.side ?? raw.position ?? "YES",
          amountStroops: amountFromApi(raw.amount ?? "0"),
          timestamp: raw.timestamp ?? raw.createdAt ?? new Date().toISOString(),
          txHash,
          ...(raw.comment ? { comment: raw.comment } : {}),
        };

        seenTxHashes.current.add(txHash);
        setNewIds(new Set([txHash]));
        setEntries((prev) => [incoming, ...prev].slice(0, 50));
        setTimeout(() => setNewIds(new Set()), 600);
      } catch {
        // ignore non-JSON or malformed messages
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [callId]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Activity</h3>
          <p className="text-xs text-gray-500">Recent stakes</p>
        </div>
        {entries.length > 0 && (
          <span className="text-xs text-gray-400">
            {entries.length} entries
          </span>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .slide-in { animation: slideIn 0.35s ease-out; }
      `}</style>

      <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="py-12 text-center text-gray-400" role="status">
            <p className="text-sm">Loading recent stakes…</p>
          </div>
        ) : error ? (
          <div className="py-12 text-center text-gray-500" role="alert">
            <p className="text-sm font-semibold text-gray-700">
              Activity could not be loaded
            </p>
            <p className="text-xs mt-1 text-gray-400">{error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-3 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Retry
              </button>
            )}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">No activity yet. Be the first to stake!</p>
          </div>
        ) : (
          entries.slice(0, visible).map((entry, i) => {
            const isUp = entry.side === "YES";
            return (
              <div
                key={`${entry.txHash}-${i}`}
                className={`px-4 py-3 hover:bg-gray-50 transition-colors ${newIds.has(entry.txHash) ? "slide-in" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-gray-500">
                      {entry.address.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="font-mono text-xs text-gray-700 truncate">
                      {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                    </span>
                    <span
                      className={`flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                        isUp
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {isUp ? "▲ UP" : "▼ DOWN"}
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p
                      className={`text-sm font-semibold ${isUp ? "text-green-600" : "text-red-600"}`}
                    >
                      {formatAmount(entry.amountStroops)} {stakeToken}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {timeAgo(entry.timestamp)}
                    </p>
                  </div>
                </div>
                {entry.comment && (
                  <p className="mt-1.5 ml-9 text-xs text-gray-500 italic leading-snug">
                    &ldquo;{entry.comment}&rdquo;
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {visible < entries.length && (
        <div className="px-4 py-3 border-t border-gray-100 text-center">
          <button
            onClick={() =>
              setVisible((v) => Math.min(v + PAGE_SIZE, entries.length))
            }
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          >
            Load more ({entries.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
