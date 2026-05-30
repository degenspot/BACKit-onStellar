"use client";

import { Participant } from "@/types";
import { useEffect, useRef, useState } from "react";

const PAGE_SIZE = 10;
const POLL_INTERVAL = 15_000;

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
  participants: Participant[];
  callId: number;
}

export default function ActivityLog({ participants, callId }: Props) {
  const [entries, setEntries] = useState<Participant[]>(participants.slice(0, 50));
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevTxHashes = useRef<Set<string>>(new Set(participants.map(p => p.txHash)));

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/calls/${callId}/stakes/recent`);
        if (!res.ok) return;
        const fresh: Participant[] = await res.json();
        const incoming = fresh.filter(p => !prevTxHashes.current.has(p.txHash));
        if (incoming.length === 0) return;

        incoming.forEach(p => prevTxHashes.current.add(p.txHash));
        setNewIds(new Set(incoming.map(p => p.txHash)));
        setEntries(prev => [...incoming, ...prev].slice(0, 50));

        // Clear slide-in highlight after animation completes
        setTimeout(() => setNewIds(new Set()), 600);
      } catch {
        // silently ignore poll errors
      }
    }, POLL_INTERVAL);

    return () => clearInterval(poll);
  }, [callId]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Activity</h3>
          <p className="text-xs text-gray-500">Recent stakes</p>
        </div>
        {entries.length > 0 && (
          <span className="text-xs text-gray-400">{entries.length} entries</span>
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
        {entries.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-2xl mb-2">📭</p>
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
                    {/* Avatar placeholder */}
                    <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-gray-500">
                      {entry.address.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="font-mono text-xs text-gray-700 truncate">
                      {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                    </span>
                    <span className={`flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                      isUp
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}>
                      {isUp ? "▲ UP" : "▼ DOWN"}
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-semibold ${isUp ? "text-green-600" : "text-red-600"}`}>
                      {entry.amount} USDC
                    </p>
                    <p className="text-[10px] text-gray-400">{timeAgo(entry.timestamp)}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {visible < entries.length && (
        <div className="px-4 py-3 border-t border-gray-100 text-center">
          <button
            onClick={() => setVisible(v => Math.min(v + PAGE_SIZE, entries.length))}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          >
            Load more ({entries.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
