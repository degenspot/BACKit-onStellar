"use client";

import { useCallback, useEffect, useState } from "react";
import CallDetail from "@/components/CallDetail";
import {
  BackendUnavailableError,
  NotFoundError,
  describeApiError,
  fetchMarket,
  type Market,
} from "@/lib/backend";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; market: Market }
  | { status: "not-found" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export default function CallDetailClient({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const market = await fetchMarket(id, { signal });
        setState({ status: "ready", market });
      } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof NotFoundError) {
          setState({ status: "not-found" });
        } else if (err instanceof BackendUnavailableError) {
          setState({ status: "unavailable", message: describeApiError(err) });
        } else {
          setState({ status: "error", message: describeApiError(err) });
        }
      }
    },
    [id],
  );

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [id, load]);

  if (state.status === "loading") {
    return (
      <div className="min-h-screen bg-gray-50">
        <div
          className="max-w-7xl mx-auto p-4 animate-pulse"
          role="status"
          aria-label="Loading market"
        >
          <div className="bg-gradient-to-r from-gray-300 to-gray-200 h-48 rounded-xl mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white h-64 rounded-xl" />
              <div className="bg-white h-96 rounded-xl" />
            </div>
            <div className="space-y-6">
              <div className="bg-white h-80 rounded-xl" />
              <div className="bg-white h-32 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Market Not Found
          </h2>
          <p className="text-gray-600 mb-6">
            This market does not exist or is no longer visible.
          </p>
          <a
            href="/feed"
            className="inline-block px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            Browse Active Markets
          </a>
        </div>
      </div>
    );
  }

  if (state.status === "unavailable" || state.status === "error") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {state.status === "unavailable"
              ? "Backend Unavailable"
              : "Unable to Load Market"}
          </h2>
          <p className="text-gray-600 mb-6">{state.message}</p>
          <button
            onClick={() => load()}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition mb-3"
          >
            Retry
          </button>
          <a
            href="/feed"
            className="block w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
          >
            Return to Feed
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <CallDetail market={state.market} onRefresh={() => load()} />
    </div>
  );
}
