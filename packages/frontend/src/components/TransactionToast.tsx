"use client";
import { useState, useEffect, useCallback } from "react";

type Status = "pending" | "confirming" | "confirmed" | "failed";
interface Toast { id: string; status: Status; txHash?: string; message?: string; }

const COLORS: Record<Status, string> = {
  pending: "bg-yellow-50 border-yellow-400 text-yellow-900",
  confirming: "bg-blue-50 border-blue-400 text-blue-900",
  confirmed: "bg-green-50 border-green-400 text-green-900",
  failed: "bg-red-50 border-red-400 text-red-900",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.status !== "confirmed") return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [toast.status, onDismiss]);

  return (
    <div className={`border rounded-lg p-3 mb-2 text-sm shadow-md ${COLORS[toast.status]}`}>
      <div className="flex justify-between items-center gap-2">
        <span className="font-semibold capitalize">{toast.status}</span>
        {toast.txHash && (
          <a href={`https://stellar.expert/explorer/public/tx/${toast.txHash}`} target="_blank" rel="noreferrer" className="underline text-xs">View tx</a>
        )}
        {toast.status === "failed" && (
          <button onClick={onDismiss} className="text-xs underline">Dismiss</button>
        )}
      </div>
      {toast.message && <p className="mt-1 text-xs opacity-80">{toast.message}</p>}
    </div>
  );
}

export function useTransactionToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((data: Omit<Toast, "id">): string => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((p) => [...p.slice(-2), { ...data, id }]);
    return id;
  }, []);
  const update = useCallback((id: string, patch: Partial<Toast>) =>
    setToasts((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);
  const remove = useCallback((id: string) =>
    setToasts((p) => p.filter((t) => t.id !== id)), []);
  return { toasts, add, update, remove };
}

export function TransactionToasts({ toasts, remove }: { toasts: Toast[]; remove: (id: string) => void }) {
  return (
    <div className="fixed bottom-4 right-4 w-72 z-50 pointer-events-none">
      <div className="pointer-events-auto">
        {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />)}
      </div>
    </div>
  );
}
