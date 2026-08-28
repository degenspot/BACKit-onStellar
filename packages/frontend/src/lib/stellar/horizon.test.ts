import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHorizonAccount } from "./horizon";

const HORIZON = "https://horizon-testnet.stellar.org";
const ADDRESS = "GCSTAKER47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL";

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(String(input))),
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

const accountPayload = {
  id: ADDRESS,
  sequence: "42",
  subentry_count: 1,
  balances: [{ asset_type: "native", balance: "100.0000000" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchHorizonAccount", () => {
  it("reads the account from the network's Horizon", async () => {
    const spy = mockFetch(() => jsonResponse(accountPayload));

    const result = await fetchHorizonAccount(HORIZON, ADDRESS);

    expect(String(spy.mock.calls[0][0])).toBe(`${HORIZON}/accounts/${ADDRESS}`);
    expect(result).toEqual({ status: "ok", account: accountPayload });
  });

  it("tolerates a trailing slash on the Horizon URL", async () => {
    const spy = mockFetch(() => jsonResponse(accountPayload));

    await fetchHorizonAccount(`${HORIZON}/`, ADDRESS);

    expect(String(spy.mock.calls[0][0])).toBe(`${HORIZON}/accounts/${ADDRESS}`);
  });

  it("reports an unfunded account distinctly from a failure", async () => {
    mockFetch(() => jsonResponse({ title: "Resource Missing" }, 404));

    await expect(fetchHorizonAccount(HORIZON, ADDRESS)).resolves.toEqual({
      status: "not-found",
    });
  });

  it("reports a server error as unavailable, never as zero balance", async () => {
    mockFetch(() => jsonResponse({ title: "Bad gateway" }, 502));

    const result = await fetchHorizonAccount(HORIZON, ADDRESS);

    expect(result.status).toBe("unavailable");
  });

  it("reports an unreachable Horizon as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    const result = await fetchHorizonAccount(HORIZON, ADDRESS);

    expect(result.status).toBe("unavailable");
    expect(result.status === "unavailable" && result.message).toContain(
      HORIZON,
    );
  });

  it("reports a malformed payload as unavailable", async () => {
    mockFetch(() => jsonResponse({ id: ADDRESS }));

    const result = await fetchHorizonAccount(HORIZON, ADDRESS);

    expect(result.status).toBe("unavailable");
  });

  it("re-throws a caller-initiated abort instead of blaming Horizon", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        controller.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }),
    );

    await expect(
      fetchHorizonAccount(HORIZON, ADDRESS, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
