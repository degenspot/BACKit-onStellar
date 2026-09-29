"use client";

import { FormEvent, useState } from "react";
import {
  addImportedToken,
  isValidAssetCode,
  isValidStellarAddress,
  loadImportedTokens,
  verifyAndBuildToken,
  type ImportedToken,
} from "@/lib/token-registry";

interface Props {
  onImported?: (token: ImportedToken) => void;
}

export function CustomTokenImporter({ onImported }: Props) {
  const [mode, setMode] = useState<"classic" | "sac">("classic");
  const [code, setCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [contractId, setContractId] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<ImportedToken[]>(() => loadImportedTokens());

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setWarnings([]);
    setBusy(true);
    try {
      const result = await verifyAndBuildToken(
        mode === "sac"
          ? { contractId, code: code || undefined }
          : { code, issuer },
      );
      setWarnings(result.warnings);
      const next = addImportedToken(result.token);
      setList(next);
      onImported?.(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/80 p-4 space-y-4 max-w-md">
      <h3 className="text-sm font-semibold text-white">Import custom token</h3>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className={`px-3 py-1 rounded-lg ${mode === "classic" ? "bg-emerald-600 text-white" : "bg-white/10 text-zinc-300"}`}
          onClick={() => setMode("classic")}
        >
          Classic asset
        </button>
        <button
          type="button"
          className={`px-3 py-1 rounded-lg ${mode === "sac" ? "bg-emerald-600 text-white" : "bg-white/10 text-zinc-300"}`}
          onClick={() => setMode("sac")}
        >
          SAC contract
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        {mode === "classic" ? (
          <>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder="Asset code (e.g. USDC)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={code.length > 0 && !isValidAssetCode(code)}
            />
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white font-mono"
              placeholder="Issuer G…"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              aria-invalid={
                issuer.length > 0 &&
                (!isValidStellarAddress(issuer) || !issuer.startsWith("G"))
              }
            />
          </>
        ) : (
          <input
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white font-mono"
            placeholder="SAC contract C…"
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            aria-invalid={
              contractId.length > 0 &&
              (!isValidStellarAddress(contractId) || !contractId.startsWith("C"))
            }
          />
        )}

        {error && (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
        {warnings.length > 0 && (
          <ul className="text-xs text-amber-400 space-y-1" role="status">
            {warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-2 text-sm font-medium text-white"
        >
          {busy ? "Verifying…" : "Import token"}
        </button>
      </form>

      {list.length > 0 && (
        <div>
          <h4 className="text-xs text-zinc-400 mb-1">Saved tokens</h4>
          <ul className="text-xs text-zinc-200 space-y-1 max-h-32 overflow-y-auto">
            {list.map((t) => (
              <li key={t.contractId ?? `${t.code}:${t.issuer}`}>
                {t.code}
                {t.issuer ? ` · ${t.issuer.slice(0, 4)}…${t.issuer.slice(-4)}` : ""}
                {t.contractId ? " · SAC" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default CustomTokenImporter;
