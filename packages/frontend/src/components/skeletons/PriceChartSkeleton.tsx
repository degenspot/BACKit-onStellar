"use client";

export function PriceChartSkeleton() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
      {/* Chart Header Details */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-2">
          {/* Icon */}
          <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg animate-shimmer-dark w-9 h-9 flex-shrink-0" />
          <div className="space-y-1.5">
            {/* Title */}
            <div className="h-4 w-40 rounded animate-shimmer-dark" />
            {/* Subtitle */}
            <div className="h-3 w-48 rounded animate-shimmer-dark" />
          </div>
        </div>

        {/* Range Selection and Price Readout */}
        <div className="flex items-center gap-4">
          <div className="text-right space-y-1">
            <div className="h-3 w-16 rounded animate-shimmer-dark ml-auto" />
            <div className="h-5 w-24 rounded animate-shimmer-dark" />
          </div>

          {/* Range tabs container */}
          <div className="h-8 w-32 bg-slate-950 border border-slate-850 p-0.5 rounded-lg animate-shimmer-dark" />
        </div>
      </div>

      {/* Chart Area wrapper */}
      <div className="relative w-full h-[320px] bg-slate-950/40 border border-slate-850 rounded-xl overflow-hidden flex flex-col justify-between p-4">
        {/* Shimmer lines representing chart grid/bars/lines */}
        <div className="w-full h-full flex flex-col justify-between py-2">
          <div className="flex justify-between items-center w-full">
            <div className="h-2 w-12 rounded animate-shimmer-dark opacity-40" />
            <div className="h-[1px] bg-slate-800 flex-grow mx-4 opacity-40" />
            <div className="h-2 w-8 rounded animate-shimmer-dark opacity-45" />
          </div>
          <div className="flex justify-between items-center w-full">
            <div className="h-2 w-12 rounded animate-shimmer-dark opacity-40" />
            <div className="h-[1px] bg-slate-800 flex-grow mx-4 opacity-45" />
            <div className="h-2 w-8 rounded animate-shimmer-dark opacity-45" />
          </div>
          <div className="flex justify-between items-center w-full">
            <div className="h-2 w-12 rounded animate-shimmer-dark opacity-40" />
            <div className="h-[1px] bg-slate-800 flex-grow mx-4 opacity-40" />
            <div className="h-2 w-8 rounded animate-shimmer-dark opacity-45" />
          </div>
          <div className="flex justify-between items-center w-full">
            <div className="h-2 w-12 rounded animate-shimmer-dark opacity-45" />
            <div className="h-[1px] bg-slate-800 flex-grow mx-4 opacity-45" />
            <div className="h-2 w-8 rounded animate-shimmer-dark opacity-40" />
          </div>
        </div>
      </div>

      {/* Legend Info */}
      <div className="mt-4 flex gap-4 border-t border-slate-850 pt-3">
        <div className="h-3 w-40 rounded animate-shimmer-dark" />
        <div className="h-3 w-40 rounded animate-shimmer-dark" />
      </div>
    </div>
  );
}

export default PriceChartSkeleton;
