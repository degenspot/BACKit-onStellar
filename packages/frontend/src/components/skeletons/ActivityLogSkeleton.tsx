"use client";

export function ActivityLogSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-4 w-20 rounded animate-shimmer" />
          <div className="h-3 w-24 rounded animate-shimmer" />
        </div>
        <div className="h-3 w-16 rounded animate-shimmer" />
      </div>

      {/* List items */}
      <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Avatar placeholder */}
                <div className="w-7 h-7 rounded-full animate-shimmer flex-shrink-0" />
                {/* Address truncate */}
                <div className="h-4 w-20 rounded animate-shimmer" />
                {/* Side indicator (UP/DOWN) */}
                <div className="h-5 w-16 rounded-full animate-shimmer" />
              </div>
              <div className="text-right flex flex-col items-end space-y-1 flex-shrink-0">
                {/* Amount */}
                <div className="h-4 w-16 rounded animate-shimmer" />
                {/* Time */}
                <div className="h-3 w-12 rounded animate-shimmer" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ActivityLogSkeleton;
