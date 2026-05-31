"use client";

import { useState, useEffect } from "react";

interface CountdownTimerProps {
  endTime: string | Date | null | undefined;
}

interface TimeState {
  label: string;
  colorClass: string;
}

function computeTimeState(endTime: string | Date | null | undefined): TimeState {
  if (!endTime) return { label: "Unknown", colorClass: "text-gray-400" };

  const end = new Date(endTime).getTime();
  const now = Date.now();
  const diff = end - now;

  if (diff <= 0) return { label: "Ended", colorClass: "text-gray-400" };

  const ONE_HOUR = 1000 * 60 * 60;
  const ONE_DAY = ONE_HOUR * 24;

  if (diff > ONE_DAY) {
    const date = new Date(endTime);
    const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { label: `Ends ${label}`, colorClass: "text-green-600" };
  }

  const hours = Math.floor(diff / ONE_HOUR);
  const minutes = Math.floor((diff % ONE_HOUR) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  const label = `Ends in ${parts.join(" ")}`;
  const colorClass = diff < ONE_HOUR ? "text-red-500" : "text-yellow-500";

  return { label, colorClass };
}

export default function CountdownTimer({ endTime }: CountdownTimerProps) {
  const [timeState, setTimeState] = useState<TimeState>(() => computeTimeState(endTime));

  useEffect(() => {
    setTimeState(computeTimeState(endTime));

    const interval = setInterval(() => {
      setTimeState(computeTimeState(endTime));
    }, 1000);

    return () => clearInterval(interval);
  }, [endTime]);

  return (
    <span className={`text-sm font-mono font-medium ${timeState.colorClass}`}>
      {timeState.label}
    </span>
  );
}
