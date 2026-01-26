"use client";

export default function ParticipantList({
  participants,
}: {
  participants: any[];
}) {
  return (
    <div>
      <h3 className="font-medium mb-2">Participants</h3>
      <ul className="space-y-1 text-sm">
        {participants.map((p) => (
          <li key={p.address} className="flex justify-between">
            <span>{p.address.slice(0, 6)}…</span>
            <span>
              {p.side} · {p.amount} USDC
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
