"use client";

export function ProfileHeaderSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start space-x-4 w-full sm:w-auto">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full animate-shimmer flex-shrink-0" />
          
          <div className="space-y-3 flex-grow min-w-0">
            {/* Display name */}
            <div className="h-6 w-48 rounded animate-shimmer" />
            
            {/* Address */}
            <div className="flex items-center space-x-2">
              <div className="h-4 w-24 rounded animate-shimmer" />
              <div className="h-5 w-32 rounded animate-shimmer" />
            </div>
            
            {/* Bio */}
            <div className="space-y-1.5 pt-1">
              <div className="h-4 w-full max-w-md rounded animate-shimmer" />
              <div className="h-4 w-2/3 max-w-md rounded animate-shimmer" />
            </div>
          </div>
        </div>

        {/* Buttons on the right */}
        <div className="flex space-x-2 self-end sm:self-center">
          <div className="h-10 w-28 rounded-lg animate-shimmer" />
          <div className="h-10 w-28 rounded-lg animate-shimmer" />
        </div>
      </div>
    </div>
  );
}

export default ProfileHeaderSkeleton;
