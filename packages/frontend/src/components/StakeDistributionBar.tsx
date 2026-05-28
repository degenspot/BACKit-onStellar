"use client";

import { useEffect, useState } from "react";

interface StakeDistributionBarProps {
  yes: number;
  no: number;
  showPool?: boolean;
}

export default function StakeDistributionBar({ yes, no, showPool = true }: StakeDistributionBarProps) {
  const total = yes + no;
  const targetYesPct = total ? Math.round((yes / total) * 100) : 50;
  const targetNoPct = 100 - targetYesPct;
  const isEmpty = total === 0;

  const [yesPct, setYesPct] = useState(50);

  useEffect(() => {
    // Animate from 50 to target on mount / data change
    const raf = requestAnimationFrame(() => setYesPct(targetYesPct));
    return () => cancelAnimationFrame(raf);
  }, [targetYesPct]);

  const barBase = "h-full transition-all duration-700 ease-out";

  return (
    <div>
      {/* Bar */}
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
        {isEmpty ? (
          <div className="w-full bg-gray-300 rounded-full" />
        ) : (
          <>
            <div
              className={`${barBase} bg-green-500`}
              style={{ width: `${yesPct}%` }}
            />
            <div
              className={`${barBase} bg-red-500`}
              style={{ width: `${100 - yesPct}%` }}
            />
          </>
        )}
      </div>

      {/* Labels */}
      <div className="flex justify-between text-[11px] font-semibold mt-1.5">
        <span className={isEmpty ? "text-gray-400" : "text-green-600"}>
          {targetYesPct}% UP
        </span>
        <span className={isEmpty ? "text-gray-400" : "text-red-500"}>
          {targetNoPct}% DOWN
        </span>
      </div>

      {/* Pool size */}
      {showPool && (
        <p className="text-[10px] text-gray-400 font-medium mt-0.5 text-center">
          {isEmpty ? "No stakes yet" : `Pool: ${total.toLocaleString()} USDC`}
        </p>
      )}
    </div>
  );
}
