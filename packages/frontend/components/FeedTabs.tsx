"use client";

import clsx from "clsx";

export default function FeedTabs({
  active,
  onChange,
}: {
  active: "for-you" | "following";
  onChange: (tab: "for-you" | "following") => void;
}) {
  return (
    <div className="flex border-b mb-4">
      {["for-you", "following"].map((tab) => (
        <button
          key={tab}
          className={clsx(
            "flex-1 p-3 text-sm font-medium",
            active === tab ? "border-b-2 border-black" : "text-gray-400"
          )}
          onClick={() => onChange(tab as any)}
        >
          {tab === "for-you" ? "For You" : "Following"}
        </button>
      ))}
    </div>
  );
}
