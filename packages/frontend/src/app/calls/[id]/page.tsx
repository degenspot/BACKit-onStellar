"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import CallDetail from "@/components/CallDetail";
import { CallDetailData } from "@/types";
import PriceChartSkeleton from "@/components/skeletons/PriceChartSkeleton";
import ActivityLogSkeleton from "@/components/skeletons/ActivityLogSkeleton";

// Health check function (checks if our mock API is responsive)
async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    // Try to fetch the first call to see if API is working
    const res = await fetch('/api/calls/1', {
      signal: controller.signal,
      method: 'HEAD'
    });
    
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export default function CallDetailPage() {
  const { id } = useParams();
  const [call, setCall] = useState<CallDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    async function fetchCall() {
      try {
        setLoading(true);
        
        // Check if API is responsive
        const isApiHealthy = await checkApiHealth();
        setApiStatus(isApiHealthy ? 'online' : 'offline');
        
        // Try to fetch from API
        const res = await fetch(`/api/calls/${id}`);
        
        if (!res.ok) {
          throw new Error(`API returned ${res.status}`);
        }
        
        const data = await res.json();
        setCall(data);
        setError(null);
        
      } catch (err) {
        console.error('Failed to fetch from API:', err);
        setError(err instanceof Error ? err.message : 'Failed to load call');
        setApiStatus('offline');
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      fetchCall();
    }
  }, [id]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20">
        <div className="max-w-7xl mx-auto p-4 lg:py-10">
          <div className="lg:grid lg:grid-cols-3 lg:gap-10">
            {/* Left column - Main content skeletons */}
            <div className="lg:col-span-2 space-y-8">
              {/* Header skeleton */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <div className="h-6 w-32 rounded animate-shimmer" />
                    <div className="h-4 w-48 rounded animate-shimmer" />
                  </div>
                  <div className="h-8 w-24 rounded-lg animate-shimmer" />
                </div>
                <div className="h-6 w-full rounded animate-shimmer" />
              </div>

              {/* Live Price Chart Skeleton */}
              <PriceChartSkeleton />

              {/* Analysis Skeleton */}
              <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm space-y-4">
                <div className="h-6 w-48 rounded animate-shimmer" />
                <div className="space-y-2">
                  <div className="h-4 w-full rounded animate-shimmer" />
                  <div className="h-4 w-full rounded animate-shimmer" />
                  <div className="h-4 w-3/4 rounded animate-shimmer" />
                </div>
              </div>

              {/* Activity Log Skeleton */}
              <ActivityLogSkeleton />
            </div>

            {/* Right column - Staking Interface / Pool Liquidity Skeleton */}
            <div className="hidden lg:block space-y-8">
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-6">
                <div className="h-4 w-28 rounded animate-shimmer" />
                <div className="space-y-3">
                  <div className="h-10 w-full rounded-xl animate-shimmer" />
                  <div className="h-10 w-full rounded-xl animate-shimmer" />
                </div>
                <div className="h-12 w-full rounded-2xl animate-shimmer" />
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-4">
                <div className="flex justify-between">
                  <div className="h-4 w-28 rounded animate-shimmer" />
                  <div className="h-4 w-16 rounded animate-shimmer" />
                </div>
                <div className="h-2 w-full bg-gray-100 rounded-full animate-shimmer" />
                <div className="space-y-2 pt-2">
                  <div className="h-3 w-20 rounded animate-shimmer" />
                  <div className="h-6 w-32 rounded animate-shimmer" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state - API is offline
  if (error || apiStatus === 'offline') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Unable to Connect</h2>
          <p className="text-gray-600 mb-6">
            {error || "The backend server is not responding. Please make sure it's running."}
          </p>
          
          <div className="space-y-3">
            <button 
              onClick={() => window.location.reload()} 
              className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
            >
              Retry Connection
            </button>
            
            <a 
              href="/" 
              className="block w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              Return to Feed
            </a>
          </div>
          
          <div className="mt-6 p-4 bg-gray-50 rounded-lg text-left">
            <p className="text-sm font-medium text-gray-700 mb-2">🔧 Troubleshooting:</p>
            <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">
              <li>Make sure your backend server is running on port 3001</li>
              <li>Check if the API endpoint is accessible</li>
              <li>Verify the call ID &quot;{id}&quot; exists in mock data</li>
              <li>Check browser console for detailed errors</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Call not found
  if (!call) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Call Not Found</h2>
          <p className="text-gray-600 mb-6">
            The prediction call with ID &quot;{id}&quot; doesn&apos;t exist.
          </p>
          
          <a 
            href="/" 
            className="inline-block px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            Browse Active Calls
          </a>
        </div>
      </div>
    );
  }

  // Success state - render the call detail
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Optional: Show API status indicator */}
      <div className="fixed top-4 right-4 z-50">
        <div className="flex items-center space-x-2 bg-white px-3 py-1 rounded-full shadow-md">
          <div className={`w-2 h-2 rounded-full ${
            apiStatus === 'online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'
          }`} />
          <span className="text-xs text-gray-600">
            API: {apiStatus === 'online' ? 'Connected' : 'Mock Data'}
          </span>
        </div>
      </div>

      {/* Render the call detail component */}
      <CallDetail call={call} />
    </div>
  );
}
