/**
 * Custom SAC / classic asset token registry (#598).
 * Persists user-imported tokens in localStorage.
 */

export interface ImportedToken {
  /** Asset code (e.g. USDC) or SAC contract id */
  code: string;
  /** Issuer account (G…) for classic assets; empty for SAC contract-only */
  issuer?: string;
  /** Soroban SAC contract address (C…) when applicable */
  contractId?: string;
  name?: string;
  decimals?: number;
  /** Issuer flag warnings from Horizon */
  flags?: {
    authRequired?: boolean;
    authRevocable?: boolean;
    authClawbackEnabled?: boolean;
  };
  /** Heuristic: orderbook depth or last trade presence */
  hasLiquidity?: boolean;
  addedAt: number;
}

const STORAGE_KEY = "backit_custom_tokens";

/** Stellar classic account (G…) or contract (C…) */
export function isValidStellarAddress(value: string): boolean {
  return /^[GC][A-Z2-7]{55}$/.test(value.trim());
}

export function isValidAssetCode(code: string): boolean {
  const c = code.trim();
  return /^[A-Za-z0-9]{1,12}$/.test(c);
}

export function loadImportedTokens(): ImportedToken[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ImportedToken[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveImportedTokens(tokens: ImportedToken[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function addImportedToken(token: ImportedToken): ImportedToken[] {
  const list = loadImportedTokens();
  const key = token.contractId ?? `${token.code}:${token.issuer ?? ""}`;
  const next = list.filter(
    (t) => (t.contractId ?? `${t.code}:${t.issuer ?? ""}`) !== key,
  );
  next.unshift({ ...token, addedAt: token.addedAt || Date.now() });
  saveImportedTokens(next);
  return next;
}

export function removeImportedToken(key: string): ImportedToken[] {
  const next = loadImportedTokens().filter(
    (t) => (t.contractId ?? `${t.code}:${t.issuer ?? ""}`) !== key,
  );
  saveImportedTokens(next);
  return next;
}

export interface AssetVerification {
  token: ImportedToken;
  warnings: string[];
}

/**
 * Verify classic asset via Horizon or SAC contract id format.
 * Network calls use the app Horizon proxy when available.
 */
export async function verifyAndBuildToken(input: {
  code?: string;
  issuer?: string;
  contractId?: string;
}): Promise<AssetVerification> {
  const warnings: string[] = [];
  const contractId = input.contractId?.trim();
  const code = input.code?.trim().toUpperCase();
  const issuer = input.issuer?.trim();

  if (contractId) {
    if (!isValidStellarAddress(contractId) || !contractId.startsWith("C")) {
      throw new Error("Invalid SAC contract address (expected C… StrKey)");
    }
    return {
      token: {
        code: code || contractId.slice(0, 8),
        contractId,
        name: code || "Custom SAC",
        addedAt: Date.now(),
        hasLiquidity: undefined,
      },
      warnings: ["Soroban SAC — confirm contract source before trading."],
    };
  }

  if (!code || !isValidAssetCode(code)) {
    throw new Error("Asset code must be 1–12 alphanumeric characters");
  }
  if (!issuer || !isValidStellarAddress(issuer) || !issuer.startsWith("G")) {
    throw new Error("Issuer must be a valid G… account");
  }

  const token: ImportedToken = {
    code,
    issuer,
    name: code,
    addedAt: Date.now(),
  };

  try {
    const res = await fetch(
      `/api/horizon/assets?code=${encodeURIComponent(code)}&issuer=${encodeURIComponent(issuer)}`,
    );
    if (res.ok) {
      const data = await res.json();
      const record = data?._embedded?.records?.[0] ?? data;
      const flags = record?.flags ?? {};
      token.flags = {
        authRequired: Boolean(flags.auth_required ?? flags.authRequired),
        authRevocable: Boolean(flags.auth_revocable ?? flags.authRevocable),
        authClawbackEnabled: Boolean(
          flags.auth_clawback_enabled ?? flags.authClawbackEnabled,
        ),
      };
      if (token.flags.authClawbackEnabled) {
        warnings.push("Issuer has clawback enabled — balances may be revoked.");
      }
      if (token.flags.authRevocable) {
        warnings.push("Issuer can revoke authorization (AUTH_REVOCABLE).");
      }
      if (token.flags.authRequired) {
        warnings.push("Issuer requires authorization before holding (AUTH_REQUIRED).");
      }
      token.hasLiquidity = Boolean(
        record?.num_accounts > 0 || record?.balances?.length,
      );
      if (token.hasLiquidity === false) {
        warnings.push("No obvious liquidity / holders found on Horizon.");
      }
    } else {
      warnings.push("Could not verify asset on Horizon — proceed with caution.");
    }
  } catch {
    warnings.push("Horizon verification failed — offline or blocked.");
  }

  return { token, warnings };
}
