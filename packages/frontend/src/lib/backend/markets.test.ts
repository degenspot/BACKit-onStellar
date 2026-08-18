import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendUnavailableError, NotFoundError } from "./http";
import { deriveOdds, fetchMarket, fetchMarketStakes } from "./markets";
import { toStroops } from "./amounts";

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const marketDto = {
  id: "b0f6d9c2-0a1e-4f0f-9d0a-2a2a5f6b1c11",
  title: "ETH > $3000 by Dec 31",
  description: "# Thesis",
  creatorAddress: "GCREATOR",
  status: "OPEN",
  outcome: "PENDING" as const,
  endsAt: "2030-12-31T23:59:59.000Z",
  createdAt: "2030-01-01T00:00:00.000Z",
  stakeToken: "USDC",
  pairId: "ETH/USDC",
  totalYesStake: "15000.0000000",
  totalNoStake: "8500.0000000",
  currentPrice: "2450.50",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMarket", () => {
  it("loads and normalises the market from the backend", async () => {
    const spy = mockFetch(() => jsonResponse(marketDto));

    const market = await fetchMarket(marketDto.id);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain(`/calls/${marketDto.id}`);
    expect(market.title).toBe(marketDto.title);
    expect(market.thesis).toBe("# Thesis");
    expect(market.totalYesStroops).toBe(toStroops("15000"));
    expect(market.totalNoStroops).toBe(toStroops("8500"));
    expect(market.resolved).toBe(false);
    expect(market.stakeToken).toBe("USDC");
  });

  it("derives the outcome from a resolved status", async () => {
    mockFetch(() =>
      jsonResponse({ ...marketDto, status: "RESOLVED_YES", outcome: null }),
    );

    const market = await fetchMarket(marketDto.id);

    expect(market.outcome).toBe("YES");
    expect(market.resolved).toBe(true);
  });

  it("raises NotFoundError for an unknown market", async () => {
    mockFetch(() => jsonResponse({ message: "Call not found" }, 404));

    await expect(fetchMarket("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("raises BackendUnavailableError when the API is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    await expect(fetchMarket(marketDto.id)).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});

describe("fetchMarketStakes", () => {
  it("normalises both envelope shapes and sorts newest first", async () => {
    mockFetch(() =>
      jsonResponse({
        data: [
          {
            id: "s1",
            userAddress: "GAAA",
            position: "YES",
            amount: "500.0000000",
            createdAt: "2030-02-01T10:00:00.000Z",
            transactionHash: "tx-1",
          },
          {
            id: "s2",
            address: "GBBB",
            side: "NO",
            amount: 250,
            timestamp: "2030-02-02T10:00:00.000Z",
            txHash: "tx-2",
          },
        ],
      }),
    );

    const stakes = await fetchMarketStakes(marketDto.id);

    expect(stakes).toHaveLength(2);
    expect(stakes[0].txHash).toBe("tx-2");
    expect(stakes[0].amountStroops).toBe(toStroops("250"));
    expect(stakes[1].address).toBe("GAAA");
    expect(stakes[1].amountStroops).toBe(toStroops("500"));
  });

  it("returns an empty list when the market has no activity", async () => {
    mockFetch(() => jsonResponse([]));
    await expect(fetchMarketStakes(marketDto.id)).resolves.toEqual([]);
  });
});

describe("deriveOdds", () => {
  it("splits the whole pool across the winning side", () => {
    const odds = deriveOdds(toStroops("15000"), toStroops("8500"));

    expect(odds.yes).toBe("1.5666");
    expect(odds.no).toBe("2.7647");
    expect(odds.totalPoolStroops).toBe(toStroops("23500"));
  });

  it("is deterministic for the same pool", () => {
    const a = deriveOdds(toStroops("1234.5678901"), toStroops("987.6543210"));
    const b = deriveOdds(toStroops("1234.5678901"), toStroops("987.6543210"));
    expect(a).toEqual(b);
  });

  it("falls back to even odds for an empty side", () => {
    const odds = deriveOdds(0n, 0n);
    expect(odds).toEqual({
      yes: "2.0000",
      no: "2.0000",
      totalPoolStroops: 0n,
    });
  });
});
