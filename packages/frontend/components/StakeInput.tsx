"use client";

import { useState } from "react";
import { signWithFreighter } from "../libs/freighter";

export default function StakeInput({ callId }: { callId: string }) {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(false);

  async function submitStake() {
    if (amount <= 0) return alert("Invalid amount");

    setLoading(true);

    try {
      const res = await fetch(`/api/calls/${callId}/stake`, {
        method: "POST",
        body: JSON.stringify({ side, amount }),
      });

      const { xdr } = await res.json();
      await signWithFreighter(xdr);

      window.location.reload();
    } catch {
      alert("Stake failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border p-4 rounded space-y-3">
      <div className="flex gap-2">
        {["YES", "NO"].map((s) => (
          <button
            key={s}
            className={`flex-1 p-2 border ${
              side === s ? "bg-black text-white" : ""
            }`}
            onClick={() => setSide(s as any)}
          >
            {s}
          </button>
        ))}
      </div>

      <input
        type="number"
        placeholder="Amount (USDC)"
        className="border p-2 w-full"
        onChange={(e) => setAmount(+e.target.value)}
      />

      <button
        onClick={submitStake}
        disabled={loading}
        className="bg-black text-white p-2 w-full"
      >
        {loading ? "Confirming…" : "Stake"}
      </button>
    </div>
  );
}
