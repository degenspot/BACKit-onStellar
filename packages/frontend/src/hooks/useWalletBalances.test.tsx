import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toStroops } from "@/lib/backend";
import { resetNetworkConfigCache } from "@/lib/networkConfig";
import { resetStakeAssetCache } from "@/lib/stellar";

const CALL_REGISTRY =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const OUTCOME_MANAGER =
  "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDRESS_A = "GCSTAKERAAIF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL";
const ADDRESS_B = "GCSTAKERBBIF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL";

const { walletContext } = vi.hoisted(() => ({
  walletContext: {
    publicKey: null as string | null,
    isConnected: false,
    network: "TESTNET" as string | null,
  },
}));

vi.mock("@/components/WalletContext", () => ({
  useWalletContext: () => walletContext,
}));

function accountPayload(address: string, usdc = "250.5000000") {
  return {
    id: address,
    sequence: "1",
    subentry_count: 1,
    balances: [
      { asset_type: "native", balance: "100.0000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER,
        balance: usdc,
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

/** Import fresh so the hook picks up the env stubbed for this test. */
async function loadHook() {
  const mod = await import("./useWalletBalances");
  return mod.useWalletBalances;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "testnet");
  vi.stubEnv("NEXT_PUBLIC_CALL_REGISTRY_CONTRACT_ID", CALL_REGISTRY);
  vi.stubEnv("NEXT_PUBLIC_OUTCOME_MANAGER_CONTRACT_ID", OUTCOME_MANAGER);
  resetNetworkConfigCache();
  resetStakeAssetCache();
  vi.resetModules();

  walletContext.publicKey = ADDRESS_A;
  walletContext.isConnected = true;
  walletContext.network = "TESTNET";

  fetchSpy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const address = url.includes(ADDRESS_B) ? ADDRESS_B : ADDRESS_A;
    return Promise.resolve(jsonResponse(accountPayload(address)));
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetNetworkConfigCache();
  resetStakeAssetCache();
});

describe("useWalletBalances", () => {
  it("loads the connected account's stake-asset balance", async () => {
    const useWalletBalances = await loadHook();
    const { result } = renderHook(() => useWalletBalances());

    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    expect(result.current.snapshot?.spendableStakeStroops).toBe(
      toStroops("250.5"),
    );
    expect(result.current.asset?.issuer).toBe(ISSUER);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(ADDRESS_A);
  });

  it("stays disconnected — and silent — with no wallet", async () => {
    walletContext.isConnected = false;
    walletContext.publicKey = null;
    const useWalletBalances = await loadHook();

    const { result } = renderHook(() => useWalletBalances());

    expect(result.current.state.status).toBe("disconnected");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-reads balances when the account changes", async () => {
    const useWalletBalances = await loadHook();
    const { result, rerender } = renderHook(() => useWalletBalances());

    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    walletContext.publicKey = ADDRESS_B;
    rerender();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(String(fetchSpy.mock.calls[1][0])).toContain(ADDRESS_B);
    await waitFor(() =>
      expect(result.current.snapshot?.address).toBe(ADDRESS_B),
    );
  });

  it("re-reads balances when the wallet switches network", async () => {
    const useWalletBalances = await loadHook();
    const { result, rerender } = renderHook(() => useWalletBalances());

    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    walletContext.network = "PUBLIC";
    rerender();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it("does not re-read on an unrelated re-render", async () => {
    const useWalletBalances = await loadHook();
    const { result, rerender } = renderHook(() => useWalletBalances());

    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    rerender();
    rerender();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("joins an in-flight read instead of firing a duplicate", async () => {
    let release: (value: Response) => void = () => {};
    fetchSpy.mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );

    const useWalletBalances = await loadHook();
    const { result } = renderHook(() => useWalletBalances());

    await act(async () => {
      void result.current.refresh();
      void result.current.refresh();
      release(jsonResponse(accountPayload(ADDRESS_A)));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    // The mount read plus two concurrent refresh calls: still one request.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes on demand once the previous read has settled", async () => {
    const useWalletBalances = await loadHook();
    const { result } = renderHook(() => useWalletBalances());

    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reports an unfunded account", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse({ title: "Resource Missing" }, 404)),
    );
    const useWalletBalances = await loadHook();

    const { result } = renderHook(() => useWalletBalances());

    await waitFor(() => expect(result.current.state.status).toBe("unfunded"));
    expect(result.current.snapshot).toBeNull();
  });

  it("reports a missing trustline separately from a zero balance", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          id: ADDRESS_A,
          sequence: "1",
          subentry_count: 0,
          balances: [{ asset_type: "native", balance: "100.0000000" }],
        }),
      ),
    );
    const useWalletBalances = await loadHook();

    const { result } = renderHook(() => useWalletBalances());

    await waitFor(() =>
      expect(result.current.state.status).toBe("no-trustline"),
    );
    expect(result.current.snapshot?.stakeAssetStroops).toBeNull();
  });

  it("keeps the previous snapshot and marks it stale when a refresh fails", async () => {
    const useWalletBalances = await loadHook();
    const { result } = renderHook(() => useWalletBalances());

    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    fetchSpy.mockImplementation(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.state.status).toBe("ready");
    expect(result.current.snapshot?.spendableStakeStroops).toBe(
      toStroops("250.5"),
    );
    expect(result.current.isStale).toBe(true);
    expect(result.current.staleReason).toMatch(/horizon/i);
  });

  it("reports config errors scoped to the stake asset", async () => {
    vi.stubEnv("NEXT_PUBLIC_STAKE_ASSET_ISSUER", "not-an-issuer");
    resetStakeAssetCache();
    vi.resetModules();
    const useWalletBalances = await loadHook();

    const { result } = renderHook(() => useWalletBalances());

    expect(result.current.state).toMatchObject({
      status: "config-error",
      scope: "asset",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports config errors scoped to the network", async () => {
    vi.stubEnv("NEXT_PUBLIC_CALL_REGISTRY_CONTRACT_ID", "");
    resetNetworkConfigCache();
    vi.resetModules();
    const useWalletBalances = await loadHook();

    const { result } = renderHook(() => useWalletBalances());

    expect(result.current.state).toMatchObject({
      status: "config-error",
      scope: "network",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
