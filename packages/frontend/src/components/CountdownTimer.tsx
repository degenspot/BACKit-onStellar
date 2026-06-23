"use client";

import { useState, useEffect } from "react";

interface CountdownTimerProps {
  endTime: string | number | Date;
  resolved?: boolean;
}

export default function CountdownTimer({
  endTime,
  resolved,
}: CountdownTimerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const end = new Date(endTime).getTime();
  const diff = end - now;

  if (resolved || diff <= 0) {
    return <span className="text-sm font-medium text-gray-400">Ended</span>;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (days > 0) {
    const dateStr = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(end);
    return (
      <span className="text-sm font-medium text-green-600">Ends {dateStr}</span>
    );
  }

  const colorClass = hours > 0 ? "text-yellow-600" : "text-red-600";
  const timeStr =
    hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;

  return (
    <span className={`text-sm font-medium ${colorClass}`}>
      Ends in {timeStr}
    </span>
  );
}
