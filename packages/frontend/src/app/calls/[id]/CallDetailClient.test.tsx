import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CallDetailClient from "./CallDetailClient";
import type { Market } from "@/lib/backend";

// The market screen itself is covered by its own components; here we assert the
// loading / ready / not-found / backend-unavailable states at the HTTP boundary.
vi.mock("@/components/CallDetail", () => ({
  default: ({ market }: { market: Market }) => (
    <div>
      <h1>{market.title}</h1>
      <p>pool:{(market.totalYesStroops + market.totalNoStroops).toString()}</p>
    </div>
  ),
}));

const MARKET_ID = "b0f6d9c2-0a1e-4f0f-9d0a-2a2a5f6b1c11";

const marketDto = {
  id: MARKET_ID,
  title: "ETH > $3000 by Dec 31",
  description: "thesis",
  creatorAddress: "GCREATOR",
  status: "OPEN",
  outcome: "PENDING",
  endsAt: "2030-12-31T23:59:59.000Z",
  createdAt: "2030-01-01T00:00:00.000Z",
  stakeToken: "USDC",
  pairId: "ETH/USDC",
  totalYesStake: "15000.0000000",
  totalNoStake: "8500.0000000",
};

function mockResponse(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify(body), {
                  status,
                  headers: { "Content-Type": "application/json" },
                }),
              ),
            0,
          ),
        ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CallDetailClient", () => {
  it("shows a loading state, then the market loaded from the backend", async () => {
    mockResponse(marketDto);

    render(<CallDetailClient id={MARKET_ID} />);

    expect(
      screen.getByRole("status", { name: /loading market/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(marketDto.title)).toBeInTheDocument();
    expect(screen.getByText("pool:235000000000")).toBeInTheDocument();
  });

  it("requests the market by id from the backend API", async () => {
    mockResponse(marketDto);

    render(<CallDetailClient id={MARKET_ID} />);
    await screen.findByText(marketDto.title);

    const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(String(spy.mock.calls[0][0])).toContain(`/calls/${MARKET_ID}`);
  });

  it("renders a not-found state for an unknown market", async () => {
    mockResponse({ message: "Call not found" }, 404);

    render(<CallDetailClient id="missing" />);

    expect(await screen.findByText(/market not found/i)).toBeInTheDocument();
  });

  it("renders a backend-unavailable state instead of mock data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    render(<CallDetailClient id={MARKET_ID} />);

    expect(await screen.findByText(/backend unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(marketDto.title)).not.toBeInTheDocument();
  });
});
