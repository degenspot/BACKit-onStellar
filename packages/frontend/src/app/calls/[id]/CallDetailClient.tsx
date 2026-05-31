"use client";

import { useEffect, useState } from "react";
import CallDetail from "@/components/CallDetail";
import { CallDetailData } from "@/types";

async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("/api/calls/1", { signal: controller.signal, method: "HEAD" });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export default function CallDetailClient({ id }: { id: string }) {
  const [call, setCall] = useState<CallDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    async function fetchCall() {
      try {
        setLoading(true);
        const isApiHealthy = await checkApiHealth();
        setApiStatus(isApiHealthy ? "online" : "offline");
        const res = await fetch(`/api/calls/${id}`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json();
        setCall(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load call");
        setApiStatus("offline");
      } finally {
        setLoading(false);
      }
    }
    if (id) fetchCall();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 animate-pulse">
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

  if (error || apiStatus === "offline") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Unable to Connect</h2>
          <p className="text-gray-600 mb-6">{error || "Backend is not responding."}</p>
          <button onClick={() => window.location.reload()} className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition mb-3">
            Retry Connection
          </button>
          <a href="/" className="block w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">
            Return to Feed
          </a>
        </div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Call Not Found</h2>
          <a href="/" className="inline-block px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
            Browse Active Calls
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="fixed top-4 right-4 z-50">
        <div className="flex items-center space-x-2 bg-white px-3 py-1 rounded-full shadow-md">
          <div className={`w-2 h-2 rounded-full ${apiStatus === "online" ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-xs text-gray-600">API: {apiStatus === "online" ? "Connected" : "Mock Data"}</span>
        </div>
      </div>
      <CallDetail call={call} />
    </div>
  );
}
