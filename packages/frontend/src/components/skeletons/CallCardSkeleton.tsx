"use client";

export function CallCardSkeleton() {
  return (
    <div className="border rounded-2xl p-5 bg-white shadow-sm border-gray-100 space-y-5">
      {/* Header with token and time */}
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          {/* Token avatar */}
          <div className="w-[44px] h-[44px] rounded-xl animate-shimmer flex-shrink-0" />
          <div className="space-y-2">
            {/* Token name */}
            <div className="h-4 w-24 rounded animate-shimmer" />
            {/* Status badge */}
            <div className="h-4 w-12 rounded-md animate-shimmer" />
          </div>
        </div>
        <div className="flex flex-col items-end space-y-1">
          {/* Ends In label */}
          <div className="h-3 w-12 rounded animate-shimmer" />
          {/* Time remaining */}
          <div className="h-6 w-16 rounded-lg animate-shimmer" />
        </div>
      </div>

      {/* Condition */}
      <div className="space-y-2">
        {/* Label */}
        <div className="h-3 w-28 rounded animate-shimmer" />
        {/* Condition text */}
        <div className="space-y-1.5">
          <div className="h-4 w-full rounded animate-shimmer" />
          <div className="h-4 w-3/4 rounded animate-shimmer" />
        </div>
      </div>

      {/* Multipliers */}
      <div className="grid grid-cols-2 gap-3">
        <div className="h-[68px] rounded-xl animate-shimmer" />
        <div className="h-[68px] rounded-xl animate-shimmer" />
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <div className="h-3 w-28 rounded animate-shimmer" />
          <div className="h-3 w-24 rounded animate-shimmer" />
        </div>
        {/* Progress bar container */}
        <div className="h-2 w-full bg-gray-100 rounded-full animate-shimmer" />
      </div>

      {/* Creator info */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <div className="flex items-center gap-2">
          {/* Creator Avatar */}
          <div className="w-8 h-8 rounded-full animate-shimmer flex-shrink-0" />
          <div className="space-y-1">
            <div className="h-3 w-10 rounded animate-shimmer" />
            <div className="h-3 w-20 rounded animate-shimmer" />
          </div>
        </div>
        <div className="flex flex-col items-end space-y-1">
          <div className="h-3 w-16 rounded animate-shimmer" />
          <div className="h-4 w-6 rounded animate-shimmer" />
        </div>
      </div>
    </div>
  );
}

export default CallCardSkeleton;
