export function CallCardSkeleton() {
  return (
    <div className="border rounded-lg p-4 animate-pulse space-y-3">
      <div className="h-4 bg-gray-200 w-1/3" />
      <div className="h-3 bg-gray-200 w-2/3" />
      <div className="h-3 bg-gray-200 w-1/2" />
    </div>
  );
}
