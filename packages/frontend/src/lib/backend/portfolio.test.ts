import { afterEach, describe, expect, it, vi } from "vitest";
import { toStroops } from "./amounts";
import { calculatePayoutStroops, fetchPortfolio } from "./portfolio";

const ADDRESS = "GSTAKER";

interface Route {
  stakes?: unknown;
  stakesStatus?: number;
  payouts?: unknown;
  payoutsStatus?: number;
}

function mockRoutes({
  stakes,
  stakesStatus = 200,
  payouts = [],
  payoutsStatus = 200,
}: Route) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const [body, status] = url.includes("/payouts")
        ? [payouts, payoutsStatus]
        : [stakes, stakesStatus];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
}

function stakeDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "stake-1",
    callId: "call-1",
    userAddress: ADDRESS,
    amount: "100.0000000",
    position: "YES",
    profitLoss: null,
    transactionHash: "tx-1",
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-02T00:00:00.000Z",
    resolutionStatus: "PENDING",
    call: {
      id: "call-1",
      title: "BTC over 50k",
      description: "desc",
      outcome: "PENDING",
      resolvedAt: null,
      expiresAt: "2030-02-01T00:00:00.000Z",
      createdAt: "2030-01-01T00:00:00.000Z",
      contractAddress: "CCONTRACT",
      totalYesStake: "1000.0000000",
      totalNoStake: "1000.0000000",
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPortfolio", () => {
  it("returns an empty portfolio for a wallet without stakes", async () => {
    mockRoutes({ stakes: { data: [], total: 0, page: 1, limit: 50 } });

    const portfolio = await fetchPortfolio(ADDRESS);

    expect(portfolio.stakes).toEqual([]);
    expect(portfolio.total).toBe(0);
    expect(portfolio.payoutsUnavailable).toBe(false);
  });

  it("marks an unresolved stake as active", async () => {
    mockRoutes({
      stakes: { data: [stakeDto()], total: 1, page: 1, limit: 50 },
    });

    const [stake] = (await fetchPortfolio(ADDRESS)).stakes;

    expect(stake.status).toBe("ACTIVE");
    expect(stake.amountStroops).toBe(toStroops("100"));
    expect(stake.payoutStroops).toBeNull();
  });

  it("marks a won, unclaimed stake as claimable with its parimutuel payout", async () => {
    mockRoutes({
      stakes: {
        data: [
          stakeDto({
            resolutionStatus: "RESOLVED",
            call: {
              ...stakeDto().call,
              outcome: "YES",
              resolvedAt: "2030-02-02T00:00:00.000Z",
            },
          }),
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
      payouts: [],
    });

    const [stake] = (await fetchPortfolio(ADDRESS)).stakes;

    expect(stake.status).toBe("CLAIMABLE");
    // 100 staked into a 1000 YES / 1000 NO pool pays 100 * 2000 / 1000.
    expect(stake.payoutStroops).toBe(toStroops("200"));
  });

  it("marks a stake as claimed when the payout ledger says so", async () => {
    mockRoutes({
      stakes: {
        data: [
          stakeDto({
            resolutionStatus: "RESOLVED",
            call: { ...stakeDto().call, outcome: "YES" },
          }),
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
      payouts: [
        {
          id: "payout-1",
          callId: "call-1",
          stakerAddress: ADDRESS,
          amount: "200.0000000",
          txHash: "claim-tx",
          claimedAt: "2030-02-03T00:00:00.000Z",
          status: "CLAIMED",
          createdAt: "2030-02-03T00:00:00.000Z",
          updatedAt: "2030-02-03T00:00:00.000Z",
        },
      ],
    });

    const [stake] = (await fetchPortfolio(ADDRESS)).stakes;

    expect(stake.status).toBe("CLAIMED");
    expect(stake.claimTxHash).toBe("claim-tx");
    expect(stake.payoutStroops).toBe(toStroops("200"));
  });

  it("marks a losing resolved stake as lost", async () => {
    mockRoutes({
      stakes: {
        data: [
          stakeDto({
            position: "NO",
            resolutionStatus: "RESOLVED",
            call: { ...stakeDto().call, outcome: "YES" },
          }),
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    });

    const [stake] = (await fetchPortfolio(ADDRESS)).stakes;

    expect(stake.status).toBe("LOST");
    expect(stake.payoutStroops).toBeNull();
  });

  it("flags an unreachable payout ledger instead of guessing claim state", async () => {
    mockRoutes({
      stakes: {
        data: [
          stakeDto({
            resolutionStatus: "RESOLVED",
            call: { ...stakeDto().call, outcome: "YES" },
          }),
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
      payouts: { message: "boom" },
      payoutsStatus: 500,
    });

    const portfolio = await fetchPortfolio(ADDRESS);

    expect(portfolio.payoutsUnavailable).toBe(true);
    expect(portfolio.stakes[0].status).toBe("CLAIMABLE");
  });
});

describe("calculatePayoutStroops", () => {
  it("returns the stake when the winning side is empty", () => {
    expect(calculatePayoutStroops(toStroops("10"), 0n, toStroops("5"))).toBe(
      toStroops("10"),
    );
  });

  it("truncates to whole stroops", () => {
    // 1 / 3 of a 10-stroop pool cannot be split evenly.
    expect(calculatePayoutStroops(1n, 3n, 7n)).toBe(3n);
  });
});
