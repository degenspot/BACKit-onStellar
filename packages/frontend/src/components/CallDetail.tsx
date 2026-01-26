"use client";

import ReactMarkdown from "react-markdown";
import StakeBar from "@/components/StakeBar";
import StakeInput from "@/components/StakeInput";
import ParticipantList from "@/components/ParticipantList";
import { useEffect, useState } from "react";

export default function CallDetail({ call }: { call: any }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = new Date(call.endTime).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("Resolved");
        clearInterval(interval);
      } else {
        const hrs = Math.floor(diff / 36e5);
        const mins = Math.floor((diff % 36e5) / 6e4);
        setTimeLeft(`${hrs}h ${mins}m`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [call.endTime]);

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-xl font-bold">{call.token.symbol}</h1>
        <p className="text-sm text-gray-500">
          Current price: ${call.token.price}
        </p>
      </div>

      <div className="border p-3 rounded">
        <p className="font-medium">Condition</p>
        <p>{call.condition}</p>
      </div>

      <StakeBar yes={call.stakes.yes} no={call.stakes.no} />

      <div className="text-sm text-gray-500">Time remaining: {timeLeft}</div>

      <div className="prose">
        <ReactMarkdown>{call.thesis}</ReactMarkdown>
      </div>

      {!call.resolved && <StakeInput callId={call.id} />}

      {call.resolved && (
        <div className="border p-3 rounded bg-green-50">
          Outcome: <strong>{call.outcome}</strong>
        </div>
      )}

      <ParticipantList participants={call.participants} />
    </main>
  );
}
