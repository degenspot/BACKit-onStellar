"use client";

export function LeaderboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Table container for desktop */}
      <div className="hidden md:block overflow-hidden rounded-2xl border border-gray-200">
        <table className="min-w-full bg-white text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3 h-10 w-24">
                <div className="h-4 w-12 rounded animate-shimmer" />
              </th>
              <th className="px-4 py-3 h-10 w-48">
                <div className="h-4 w-16 rounded animate-shimmer" />
              </th>
              <th className="px-4 py-3 h-10 w-32">
                <div className="h-4 w-20 rounded animate-shimmer" />
              </th>
              <th className="px-4 py-3 h-10 w-32">
                <div className="h-4 w-24 rounded animate-shimmer" />
              </th>
              <th className="px-4 py-3 h-10 w-32">
                <div className="h-4 w-28 rounded animate-shimmer" />
              </th>
            </tr>
          </thead>
          <tbody>
            {[...Array(6)].map((_, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-4 py-5">
                  <div className="h-6 w-12 rounded-full animate-shimmer" />
                </td>
                <td className="px-4 py-5">
                  <div className="h-4 w-32 rounded animate-shimmer" />
                </td>
                <td className="px-4 py-5">
                  <div className="h-4 w-16 rounded animate-shimmer" />
                </td>
                <td className="px-4 py-5">
                  <div className="h-4 w-20 rounded animate-shimmer" />
                </td>
                <td className="px-4 py-5">
                  <div className="h-4 w-12 rounded animate-shimmer" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* List container for mobile */}
      <div className="space-y-3 md:hidden">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="block rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex justify-between items-center">
              <div className="h-6 w-12 rounded-full animate-shimmer" />
              <div className="h-3.5 w-24 rounded animate-shimmer" />
            </div>
            <div className="h-4 w-32 rounded animate-shimmer" />
            <div className="h-3.5 w-40 rounded animate-shimmer" />
            <div className="h-3.5 w-28 rounded animate-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default LeaderboardSkeleton;
