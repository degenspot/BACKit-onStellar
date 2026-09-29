"use client";

import { useEffect, useState } from "react";
import { Info, Fuel } from "lucide-react";
import {
  getGasStationQuote,
  getGasStationTopUpPath,
  type GasStationQuote,
} from "@/lib/gas-station-adapter";

interface Props {
  /** Transaction XDR for a live resource estimate */
  xdr?: string;
  /** Connected account for gas station allowance */
  account?: string | null;
}

export default function GasFeeDisplay({ xdr, account }: Props) {
  const [quote, setQuote] = useState<GasStationQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    getGasStationQuote(account, xdr, ctrl.signal)
      .then((q) => setQuote(q))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [xdr, account]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="h-3 w-40 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (error || !quote) return null;

  const { allowance, resources, sponsored, badgeLabel } = quote;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2 text-xs">
      {sponsored ? (
        <p className="text-emerald-500 font-medium flex items-center gap-1.5">
          <Fuel className="w-3.5 h-3.5" aria-hidden />
          <span>{badgeLabel}</span>
        </p>
      ) : (
        <p className="text-amber-500 font-medium flex items-center gap-1.5">
          <Fuel className="w-3.5 h-3.5" aria-hidden />
          <span>{badgeLabel}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-zinc-400">
        <div>
          <span className="block text-[10px] uppercase tracking-wide">CPU</span>
          <span className="text-zinc-200">
            {resources.cpuInstructions.toLocaleString()} insn
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wide">Memory</span>
          <span className="text-zinc-200">
            {resources.memoryBytes.toLocaleString()} B
          </span>
        </div>
        <div className="col-span-2 flex items-center gap-1">
          <span>
            Network fee:{" "}
            <strong className="text-zinc-100">
              {resources.feeXlm} XLM
            </strong>{" "}
            ({resources.feeStroops.toLocaleString()} stroops ·{" "}
            {resources.feeUsdEstimate})
          </span>
          <span
            title="Resource fees are charged by the Stellar network for CPU and memory."
            className="cursor-help"
          >
            <Info className="w-3 h-3 inline" />
          </span>
        </div>
      </div>

      {!allowance.canSponsor && (
        <a
          href={getGasStationTopUpPath()}
          className="inline-flex text-emerald-400 hover:underline font-medium"
        >
          Top up / pay with XLM →
        </a>
      )}
    </div>
  );
}
