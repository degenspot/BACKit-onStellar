import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StakingInterface from "./StakingInterface";
import type { CallDetailData } from "@/types";

/** Testnet USDC issuer used by the default configuration. */
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDRESS = "GSTAKER";

let walletState: {
  isConnected: boolean;
  publicKey: string | null;
  wallet: { status: string; network?: string };
};

vi.mock("./WalletContext", () => ({
  useWalletContext: () => walletState,
}));

// These children do their own network calls and are covered elsewhere.
vi.mock("./PayoutCalculator", () => ({ default: () => null }));
vi.mock("./GasFeeDisplay", () => ({ default: () => null }));

function horizonAccount({
  native = "100.0000000",
  usdc,
  subentries = 1,
}: {
  native?: string;
  usdc?: string;
  subentries?: number;
}) {
  const balances: Record<string, string>[] = [
    { asset_type: "native", balance: native },
  ];
  if (usdc !== undefined) {
    balances.push({
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: USDC_ISSUER,
      balance: usdc,
    });
  }
  return { balances, subentry_count: subentries };
}

function mockHorizon(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
}

const call = {
  id: "call-1",
  title: "ETH > $3000",
  thesis: "",
  tokenAddress: "",
  pairId: "ETH/USDC",
  token: { symbol: "ETH", price: 2450 },
  stakeToken: "USDC",
  stakeAmount: "0",
  creatorAddress: "GCREATOR",
  endTime: new Date(Date.now() + 86_400_000).toISOString(),
  resolved: false,
  stakes: { yes: 100, no: 100 },
  participants: [],
  condition: "ETH > 3000",
} as unknown as CallDetailData;

const odds = { yes: 2, no: 2 };

beforeEach(() => {
  walletState = {
    isConnected: true,
    publicKey: ADDRESS,
    wallet: { status: "connected", network: "TESTNET" },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stakeButton = () => screen.getByRole("button", { name: /stake on/i });

describe("StakingInterface wallet balance states", () => {
  it("blocks staking and shows a prompt when no wallet is connected", async () => {
    walletState = {
      isConnected: false,
      publicKey: null,
      wallet: { status: "disconnected" },
    };
    mockHorizon(horizonAccount({ usdc: "500.0000000" }));

    render(<StakingInterface call={call} odds={odds} onStake={vi.fn()} />);

    expect(
      await screen.findByText(/wallet not connected/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("reports an unfunded account", async () => {
    mockHorizon({ status: 404, title: "Resource Missing" }, 404);

    render(<StakingInterface call={call} odds={odds} onStake={vi.fn()} />);

    expect(await screen.findByText(/account not funded/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("reports a missing trustline for the configured stake asset", async () => {
    mockHorizon(horizonAccount({ native: "50.0000000" }));

    render(<StakingInterface call={call} odds={odds} onStake={vi.fn()} />);

    expect(await screen.findByText(/no usdc trustline/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("reports insufficient XLM for fees", async () => {
    mockHorizon(horizonAccount({ native: "1.2000000", usdc: "500.0000000" }));

    render(<StakingInterface call={call} odds={odds} onStake={vi.fn()} />);

    expect(
      await screen.findByText(/not enough xlm for fees/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("reports a zero stake-asset balance", async () => {
    mockHorizon(horizonAccount({ usdc: "0.0000000" }));

    render(<StakingInterface call={call} odds={odds} onStake={vi.fn()} />);

    expect(await screen.findByText(/no spendable usdc/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("reports a Horizon outage instead of assuming a balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    render(<StakingInterface call={call} odds={odds} onStake={vi.fn()} />);

    expect(await screen.findByText(/balance unavailable/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("blocks staking on a closed market", async () => {
    mockHorizon(horizonAccount({ usdc: "500.0000000" }));

    render(
      <StakingInterface
        call={{ ...call, resolved: true } as CallDetailData}
        odds={odds}
        onStake={vi.fn()}
      />,
    );

    expect(await screen.findByText(/market closed/i)).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });
});

describe("StakingInterface amount presets", () => {
  it("derives the presets from the live balance instead of a constant", async () => {
    mockHorizon(horizonAccount({ usdc: "250.7500000" }));

    render(<StakingInterface call={call} odds={odds} onStake={vi.fn()} />);

    const input = await screen.findByLabelText(/stake amount in usdc/i);
    // Shown both on the balance row and on the spendable hint.
    await waitFor(() =>
      expect(screen.getAllByText(/250\.75 USDC/).length).toBeGreaterThan(0),
    );

    await userEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(input).toHaveValue("250.7500000");

    await userEvent.click(screen.getByRole("button", { name: "25%" }));
    expect(input).toHaveValue("62.6875000");
  });

  it("caps MAX at the contract maximum stake", async () => {
    mockHorizon(horizonAccount({ usdc: "500.0000000" }));

    render(
      <StakingInterface
        call={call}
        odds={odds}
        onStake={vi.fn()}
        stakeLimits={{ minStroops: 0n, maxStroops: 1_000_000_000n }}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "MAX" }));
    expect(await screen.findByLabelText(/stake amount in usdc/i)).toHaveValue(
      "100.0000000",
    );
  });

  it("disables submission for an amount above the spendable balance", async () => {
    mockHorizon(horizonAccount({ usdc: "20.0000000" }));

    render(<StakingInterface call={call} odds={odds} onStake={vi.fn()} />);

    const input = await screen.findByLabelText(/stake amount in usdc/i);
    await userEvent.clear(input);
    await userEvent.type(input, "50");
    await userEvent.click(screen.getByRole("button", { name: /market yes/i }));

    expect(
      await screen.findByText(/amount exceeds your balance/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("disables submission below the contract minimum", async () => {
    mockHorizon(horizonAccount({ usdc: "500.0000000" }));

    render(
      <StakingInterface
        call={call}
        odds={odds}
        onStake={vi.fn()}
        stakeLimits={{ minStroops: 250_000_000n, maxStroops: null }}
      />,
    );

    const input = await screen.findByLabelText(/stake amount in usdc/i);
    await userEvent.clear(input);
    await userEvent.type(input, "5");

    expect(
      await screen.findByText(/below the minimum stake/i),
    ).toBeInTheDocument();
    expect(stakeButton()).toBeDisabled();
  });

  it("submits a full-precision decimal string and refreshes the balance", async () => {
    mockHorizon(horizonAccount({ usdc: "250.7500000" }));
    const onStake = vi.fn().mockResolvedValue(undefined);

    render(<StakingInterface call={call} odds={odds} onStake={onStake} />);

    await userEvent.click(await screen.findByRole("button", { name: "MAX" }));
    await userEvent.click(screen.getByRole("button", { name: /market yes/i }));
    await userEvent.click(stakeButton());

    await waitFor(() => expect(onStake).toHaveBeenCalledTimes(1));
    expect(onStake).toHaveBeenCalledWith("250.7500000", "YES");

    // One load on mount, one refresh after the stake — no duplicate requests.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
  });

  it("surfaces a failed stake transaction", async () => {
    mockHorizon(horizonAccount({ usdc: "250.0000000" }));
    const onStake = vi.fn().mockRejectedValue(new Error("User declined"));

    render(<StakingInterface call={call} odds={odds} onStake={onStake} />);

    await userEvent.click(await screen.findByRole("button", { name: "MAX" }));
    await userEvent.click(screen.getByRole("button", { name: /market no/i }));
    await userEvent.click(stakeButton());

    expect(await screen.findByText(/user declined/i)).toBeInTheDocument();
  });
});
