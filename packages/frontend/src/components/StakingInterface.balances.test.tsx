import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toStroops, type Market, type MarketOdds } from "@/lib/backend";
import {
  parseStakeAsset,
  type BalanceSnapshot,
  type StakeAsset,
  type StakeLimits,
} from "@/lib/stellar";
import type { NetworkMatch } from "@/lib/networkConfig";
import type { WalletBalanceState } from "@/hooks/useWalletBalances";
import StakingInterface from "./StakingInterface";

const assetResult = parseStakeAsset({}, "TESTNET");
if (assetResult.status !== "ok")
  throw new Error("test asset failed to resolve");
const USDC: StakeAsset = assetResult.asset;

const { walletContext, balances } = vi.hoisted(() => {
  const walletContext = {
    publicKey: "GSTAKER" as string | null,
    walletType: "freighter" as string | null,
    isConnected: true,
    network: "TESTNET" as string | null,
    networkStatus: { status: "match" } as NetworkMatch,
    requireNetworkMatch: () => {},
    configuredNetwork: "TESTNET" as string | null,
    networkConfigErrors: [] as string[],
    disconnect: () => {},
  };
  const balances = {
    state: { status: "loading" } as WalletBalanceState,
    snapshot: null as unknown,
    asset: null as unknown,
    limits: null as unknown,
    isStale: false,
    staleReason: null as string | null,
    isRefreshing: false,
    refresh: vi.fn(() => Promise.resolve()),
  };
  return { walletContext, balances };
});

vi.mock("./WalletContext", () => ({ useWalletContext: () => walletContext }));
vi.mock("@/hooks/useWalletBalances", () => ({
  useWalletBalances: () => balances,
}));
vi.mock("./GasFeeDisplay", () => ({ default: () => null }));
vi.mock("./PayoutCalculator", () => ({ default: () => null }));

const submitStakeMock = vi.fn();
vi.mock("@/lib/backend", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    submitStake: (...args: unknown[]) => submitStakeMock(...args),
  };
});

const LIMITS: StakeLimits = {
  minStroops: toStroops("1"),
  maxStroops: null,
};

function makeSnapshot(
  overrides: Partial<BalanceSnapshot> = {},
): BalanceSnapshot {
  return {
    address: "GSTAKER",
    assetId: USDC.id,
    nativeStroops: toStroops("100"),
    reservedNativeStroops: toStroops("1.5"),
    spendableNativeStroops: toStroops("98.5"),
    stakeAssetStroops: toStroops("250.5"),
    spendableStakeStroops: toStroops("250.5"),
    hasTrustline: true,
    trustlineUnauthorized: false,
    feeBufferStroops: toStroops("0.1"),
    hasFeeBuffer: true,
    fetchedAt: 1_000,
    ...overrides,
  };
}

/** Put the hook into a `ready` state built on `snapshot`. */
function ready(overrides: Partial<BalanceSnapshot> = {}) {
  const snapshot = makeSnapshot(overrides);
  balances.state = { status: "ready", snapshot };
  balances.snapshot = snapshot;
  return snapshot;
}

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "call-1",
    title: "BTC over 50k",
    thesis: "thesis",
    condition: "BTC > $50k",
    conditionJson: null,
    creatorAddress: "GCREATOR",
    pairId: "BTC/USDC",
    tokenSymbol: "BTC",
    stakeToken: "USDC",
    contractAddress: null,
    status: "OPEN",
    outcome: "PENDING",
    resolved: false,
    endTime: "2099-01-01T00:00:00.000Z",
    resolvedAt: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    totalYesStroops: 1000n,
    totalNoStroops: 1000n,
    currentPrice: null,
    startPrice: null,
    targetPrice: null,
    isBookmarked: false,
    bookmarkCount: 0,
    ...overrides,
  };
}

const odds: MarketOdds = {
  yes: "2.0000",
  no: "2.0000",
  totalPoolStroops: 2000n,
};

const stakeButton = () => screen.getByRole("button", { name: /stake on/i });
const amountField = () => screen.getByLabelText(/stake amount \(usdc\)/i);

async function pickYes() {
  await userEvent.click(screen.getByRole("button", { name: /market yes/i }));
}

async function renderAndPickYes(market: Market = makeMarket()) {
  render(<StakingInterface market={market} odds={odds} />);
  await pickYes();
}

beforeEach(() => {
  walletContext.publicKey = "GSTAKER";
  walletContext.walletType = "freighter";
  walletContext.isConnected = true;
  walletContext.network = "TESTNET";
  walletContext.networkStatus = { status: "match" };
  walletContext.requireNetworkMatch = () => {};

  balances.state = { status: "loading" };
  balances.snapshot = null;
  balances.asset = USDC;
  balances.limits = LIMITS;
  balances.isStale = false;
  balances.staleReason = null;
  balances.isRefreshing = false;
  balances.refresh = vi.fn(() => Promise.resolve());

  submitStakeMock.mockReset();
  submitStakeMock.mockResolvedValue({ hash: "tx-hash" });
});

describe("balance states", () => {
  it("tells a disconnected wallet to connect and blocks staking", async () => {
    walletContext.isConnected = false;
    walletContext.publicKey = null;
    balances.state = { status: "disconnected" };

    await renderAndPickYes();

    expect(screen.getByText(/wallet not connected/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("distinguishes an unfunded account and blocks staking", async () => {
    balances.state = { status: "unfunded" };

    await renderAndPickYes();

    expect(screen.getByText(/account not funded/i)).toBeInTheDocument();
    expect(
      screen.getByText(/does not exist yet\. send it xlm/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("distinguishes a missing trustline and blocks staking", async () => {
    const snapshot = makeSnapshot({
      hasTrustline: false,
      stakeAssetStroops: null,
      spendableStakeStroops: 0n,
    });
    balances.state = { status: "no-trustline", snapshot };
    balances.snapshot = snapshot;

    await renderAndPickYes();

    expect(screen.getByText(/no usdc trustline/i)).toBeInTheDocument();
    expect(screen.getByText(/add a trustline for usdc/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("names an unauthorized trustline rather than a missing one", async () => {
    const snapshot = makeSnapshot({
      hasTrustline: false,
      trustlineUnauthorized: true,
      spendableStakeStroops: 0n,
    });
    balances.state = { status: "no-trustline", snapshot };
    balances.snapshot = snapshot;

    await renderAndPickYes();

    expect(
      screen.getByText(/has not been authorized by the issuer/i),
    ).toBeInTheDocument();
  });

  it("distinguishes an unreachable RPC without pretending the balance is zero", async () => {
    balances.state = {
      status: "unavailable",
      message: "Could not reach Horizon at https://horizon-testnet.stellar.org",
    };

    await renderAndPickYes();

    expect(screen.getByText(/balance unavailable/i)).toBeInTheDocument();
    // Unknown is not zero: an unreachable Horizon must not block a stake the
    // network itself would accept.
    expect(stakeButton()).toBeEnabled();
  });

  it("warns that a stale snapshot may be out of date", async () => {
    ready();
    balances.isStale = true;
    balances.staleReason = "Horizon returned 502";

    await renderAndPickYes();

    expect(screen.getByText(/balance may be out of date/i)).toBeInTheDocument();
    expect(stakeButton()).toBeEnabled();
  });

  it("distinguishes a zero balance and blocks staking", async () => {
    ready({ stakeAssetStroops: 0n, spendableStakeStroops: 0n });

    await renderAndPickYes();

    expect(screen.getByText(/no spendable usdc/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("distinguishes an insufficient fee balance and blocks staking", async () => {
    ready({
      nativeStroops: toStroops("1.05"),
      spendableNativeStroops: 0n,
      hasFeeBuffer: false,
    });

    await renderAndPickYes();

    expect(
      screen.getByText(/not enough xlm for network fees/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("shows the spendable balance once it loads", async () => {
    ready();

    await renderAndPickYes();

    expect(screen.getByText(/available: 250\.50 usdc/i)).toBeInTheDocument();
    expect(stakeButton()).toBeEnabled();
  });

  it("refuses a market denominated in another asset", async () => {
    ready();

    await renderAndPickYes(makeMarket({ stakeToken: "EURC" }));

    expect(screen.getByText(/unsupported stake asset/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });
});

describe("percentage presets", () => {
  it("derives every preset from the live spendable balance", async () => {
    ready();
    await renderAndPickYes();

    expect(
      screen.getByRole("button", { name: /stake 25 percent, 62\.625 usdc/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /stake 50 percent, 125\.25 usdc/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /stake 75 percent, 187\.875 usdc/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /stake maximum, 250\.5 usdc/i }),
    ).toBeEnabled();
  });

  it("MAX fills the field with the exact spendable balance", async () => {
    ready({ spendableStakeStroops: toStroops("12.3456789") });
    await renderAndPickYes();

    await userEvent.click(
      screen.getByRole("button", { name: /stake maximum, 12\.3456789 usdc/i }),
    );

    expect(amountField()).toHaveValue("12.3456789");
    expect(stakeButton()).toBeEnabled();
  });

  it("MAX respects the contract maximum stake", async () => {
    balances.limits = {
      minStroops: toStroops("1"),
      maxStroops: toStroops("100"),
    };
    ready();
    await renderAndPickYes();

    await userEvent.click(
      screen.getByRole("button", { name: /stake maximum, 100 usdc/i }),
    );

    expect(amountField()).toHaveValue("100");
  });

  it("disables the presets when nothing is spendable", async () => {
    ready({ spendableStakeStroops: 0n, stakeAssetStroops: 0n });
    await renderAndPickYes();

    expect(
      screen.getByRole("button", { name: /max — no spendable usdc balance/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /25% — no spendable usdc balance/i }),
    ).toBeDisabled();
  });

  it("disables the presets while the balance is unknown", async () => {
    balances.state = { status: "unavailable", message: "Horizon is down" };
    await renderAndPickYes();

    expect(
      screen.getByRole("button", { name: /max — no spendable usdc balance/i }),
    ).toBeDisabled();
  });

  it("disables fixed quick-picks above the spendable balance", async () => {
    ready({ spendableStakeStroops: toStroops("60") });
    await renderAndPickYes();

    expect(
      screen.getByRole("button", { name: /^stake 50 usdc$/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /^stake 250 usdc$/i }),
    ).toBeDisabled();
  });
});

describe("amount validation", () => {
  it("blocks an amount above the spendable balance", async () => {
    ready({ spendableStakeStroops: toStroops("40") });
    await renderAndPickYes();

    await userEvent.clear(amountField());
    await userEvent.type(amountField(), "41");

    expect(
      screen.getByText(/you can stake at most 40\.00 usdc/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("blocks an amount below the contract minimum", async () => {
    ready();
    await renderAndPickYes();

    await userEvent.clear(amountField());
    await userEvent.type(amountField(), "0.5");

    expect(
      screen.getByText(/minimum stake is 1\.00 usdc/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("blocks an amount above the contract maximum", async () => {
    balances.limits = {
      minStroops: toStroops("1"),
      maxStroops: toStroops("100"),
    };
    ready({ spendableStakeStroops: toStroops("1000") });
    await renderAndPickYes();

    await userEvent.clear(amountField());
    await userEvent.type(amountField(), "101");

    expect(
      screen.getByText(/maximum stake is 100\.00 usdc/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("blocks an empty or zero amount", async () => {
    ready();
    await renderAndPickYes();

    await userEvent.clear(amountField());

    expect(
      screen.getByText(/enter a stake amount greater than zero/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("blocks staking on a closed market", async () => {
    ready();

    await renderAndPickYes(makeMarket({ resolved: true }));

    expect(stakeButton()).toBeDisabled();
    expect(
      screen.getByText(/this market is closed and no longer accepts stakes/i),
    ).toBeInTheDocument();
  });

  it("keeps the seventh decimal place out of the submitted amount", async () => {
    ready();
    await renderAndPickYes();

    await userEvent.clear(amountField());
    await userEvent.type(amountField(), "1.123456789");

    expect(amountField()).toHaveValue("1.1234567");
  });
});

describe("post-stake refresh", () => {
  it("re-reads balances after a successful stake", async () => {
    ready();
    const onStaked = vi.fn();
    render(
      <StakingInterface
        market={makeMarket()}
        odds={odds}
        onStaked={onStaked}
      />,
    );
    await pickYes();

    await userEvent.click(stakeButton());

    await waitFor(() => expect(submitStakeMock).toHaveBeenCalledTimes(1));
    expect(balances.refresh).toHaveBeenCalledTimes(1);
    expect(onStaked).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the stake fails", async () => {
    ready();
    submitStakeMock.mockRejectedValue(new Error("signature rejected"));
    await renderAndPickYes();

    await userEvent.click(stakeButton());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /signature rejected/i,
      ),
    );
    expect(balances.refresh).not.toHaveBeenCalled();
  });
});
