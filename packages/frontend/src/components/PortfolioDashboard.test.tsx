import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortfolioDashboard from "./PortfolioDashboard";

const ADDRESS = "GSTAKER";

vi.mock("./ActiveAlerts", () => ({
  default: () => null,
}));

vi.mock("./WalletContext", () => ({
  useWalletContext: () => ({
    publicKey: ADDRESS,
    walletType: "freighter",
    isConnected: true,
  }),
}));

const claimPayoutMock = vi.fn();
vi.mock("@/lib/walletSigning", () => ({
  signTransactionWithWallet: vi.fn(async () => "signed-xdr"),
}));

vi.mock("@/lib/backend", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    claimPayout: (...args: unknown[]) => claimPayoutMock(...args),
  };
});

interface RouteBodies {
  stakes: unknown;
  payouts?: unknown;
  stakesStatus?: number;
}

function mockHttp({ stakes, payouts = [], stakesStatus = 200 }: RouteBodies) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const isPayouts = url.includes("/payouts");
      return Promise.resolve(
        new Response(JSON.stringify(isPayouts ? payouts : stakes), {
          status: isPayouts ? 200 : stakesStatus,
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
    profitLoss: "100.0000000",
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

const resolvedWonStake = stakeDto({
  resolutionStatus: "RESOLVED",
  call: {
    ...stakeDto().call,
    outcome: "YES",
    resolvedAt: "2030-02-02T00:00:00.000Z",
  },
});

const claimedPayout = {
  id: "payout-1",
  callId: "call-1",
  stakerAddress: ADDRESS,
  amount: "200.0000000",
  txHash: "claim-tx",
  claimedAt: "2030-02-03T00:00:00.000Z",
  status: "CLAIMED",
  createdAt: "2030-02-03T00:00:00.000Z",
  updatedAt: "2030-02-03T00:00:00.000Z",
};

function page(data: unknown[]) {
  return { data, total: data.length, page: 1, limit: 50 };
}

afterEach(() => {
  vi.unstubAllGlobals();
  claimPayoutMock.mockReset();
});

describe("PortfolioDashboard", () => {
  it("shows the empty state for a wallet with no stakes", async () => {
    mockHttp({ stakes: page([]) });

    render(<PortfolioDashboard address={ADDRESS} />);

    expect(await screen.findByText(/no stakes yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no active stakes found/i)).toBeInTheDocument();
  });

  it("lists an active stake with its live odds", async () => {
    mockHttp({ stakes: page([stakeDto()]) });

    render(<PortfolioDashboard address={ADDRESS} />);

    expect(await screen.findByText("BTC over 50k")).toBeInTheDocument();
    expect(screen.getByText("2.00x")).toBeInTheDocument();
    // Stake amount is shown both in the card and in the value-locked summary.
    expect(screen.getAllByText(/100\.00/).length).toBeGreaterThan(0);
  });

  it("offers a claim for a won, unclaimed payout and submits it through the backend", async () => {
    mockHttp({ stakes: page([resolvedWonStake]), payouts: [] });
    claimPayoutMock.mockResolvedValue({ hash: "submitted-tx" });

    render(<PortfolioDashboard address={ADDRESS} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /claimable payouts/i }),
    );
    const claimButton = await screen.findByRole("button", {
      name: /claim payout/i,
    });
    await userEvent.click(claimButton);

    await waitFor(() => expect(claimPayoutMock).toHaveBeenCalledTimes(1));
    expect(claimPayoutMock.mock.calls[0][0]).toBe("call-1");
    expect(
      await screen.findByText(/payout claim submitted/i),
    ).toBeInTheDocument();
  });

  it("surfaces a transaction failure without changing the stake state", async () => {
    mockHttp({ stakes: page([resolvedWonStake]), payouts: [] });
    claimPayoutMock.mockRejectedValue(new Error("User declined the request"));

    render(<PortfolioDashboard address={ADDRESS} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /claimable payouts/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /claim payout/i }),
    );

    expect(
      await screen.findByText(/user declined the request/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /claim payout/i }),
    ).toBeInTheDocument();
  });

  it("shows an already-claimed payout in history and not as claimable", async () => {
    mockHttp({ stakes: page([resolvedWonStake]), payouts: [claimedPayout] });

    render(<PortfolioDashboard address={ADDRESS} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /claimable payouts/i }),
    );
    expect(
      screen.getByText(/no claimable payouts available/i),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /staking history/i }),
    );
    // Rendered once in the desktop table and once in the mobile card list.
    expect((await screen.findAllByText("Claimed")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+200\.00/).length).toBeGreaterThan(0);
  });

  it("reports a backend outage instead of falling back to placeholder data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    render(<PortfolioDashboard address={ADDRESS} />);

    expect(await screen.findByText(/backend unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText("BTC over 50k")).not.toBeInTheDocument();
  });
});
