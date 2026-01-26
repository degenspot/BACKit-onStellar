"use client";

export default function StakeBar({ yes, no }: { yes: number; no: number }) {
  const total = yes + no;
  const yesPct = total ? (yes / total) * 100 : 50;
  const noPct = 100 - yesPct;

  return (
    <div>
      <div className="flex h-4 rounded overflow-hidden">
        <div className="bg-green-500" style={{ width: `${yesPct}%` }} />
        <div className="bg-red-500" style={{ width: `${noPct}%` }} />
      </div>

      <div className="flex justify-between text-xs mt-1">
        <span>YES: {yes} USDC</span>
        <span>NO: {no} USDC</span>
      </div>
    </div>
  );
}
