import { useState } from "react";

interface FilterBarProps {
  onFilterChange: (filters: { status: string | null }) => void;
}

export default function FilterBar({ onFilterChange }: FilterBarProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const filters = [
    { id: null, label: "All" },
    { id: "OPEN", label: "Open" },
    { id: "ENDED", label: "Ended" },
    { id: "CLAIMS_READY", label: "Claims Ready" },
  ];

  const handleFilterClick = (filterId: string | null) => {
    setActiveFilter(filterId);
    onFilterChange({ status: filterId });
  };

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {filters.map((filter) => (
        <button
          key={filter.id || "all"}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            activeFilter === filter.id
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
          onClick={() => handleFilterClick(filter.id)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}