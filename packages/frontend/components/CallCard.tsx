"use client";

export default function CallCard({ call }: { call: any }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex justify-between">
        <span className="font-semibold">{call.token}</span>
        <span className="text-sm text-gray-500">{call.timeRemaining}</span>
      </div>

      <p className="text-sm">
        Condition: <strong>{call.condition}</strong>
      </p>

      <p className="text-sm">
        Stakes: <strong>{call.stakes} USDC</strong>
      </p>

      <div className="text-xs text-gray-500">Created by @{call.creator}</div>
    </div>
  );
}
