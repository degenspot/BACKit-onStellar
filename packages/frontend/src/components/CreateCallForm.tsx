"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import TokenSearch from "@/components/TokenSearch";
import ConditionBuilder from "@/components/ConditionBuilder";
import { signWithFreighter } from "@/lib/freighter";

export default function CreateCallForm() {
  const [token, setToken] = useState<any>(null);
  const [condition, setCondition] = useState({ type: "TARGET" });
  const [stake, setStake] = useState(0);
  const [endTime, setEndTime] = useState("");
  const [thesis, setThesis] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!token || stake <= 0 || !endTime) return alert("Invalid form");

    setLoading(true);

    try {
      // Normally returned from backend
      const unsignedXDR = "AAAA...";

      await signWithFreighter(unsignedXDR);

      window.location.href = "/calls/123";
    } catch (e) {
      alert("Transaction failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <TokenSearch onSelect={setToken} />

      <ConditionBuilder value={condition} onChange={setCondition} />

      <input
        type="number"
        className="border p-2 w-full"
        placeholder="Stake amount (USDC)"
        value={stake}
        onChange={(e) => setStake(+e.target.value)}
      />

      <input
        type="datetime-local"
        className="border p-2 w-full"
        onChange={(e) => setEndTime(e.target.value)}
      />

      <textarea
        className="border p-2 w-full"
        placeholder="Thesis (Markdown supported)"
        rows={4}
        onChange={(e) => setThesis(e.target.value)}
      />

      <div className="prose">
        <ReactMarkdown>{thesis}</ReactMarkdown>
      </div>

      <button
        disabled={loading}
        onClick={handleSubmit}
        className="bg-black text-white p-3 w-full"
      >
        {loading ? "Submitting…" : "Create Call"}
      </button>
    </div>
  );
}
