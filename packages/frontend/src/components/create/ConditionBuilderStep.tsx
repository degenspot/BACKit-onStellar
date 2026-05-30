"use client";

import type { ConditionForm, StepErrors } from "./types";

const conditionOptions = [
  {
    type: "TARGET",
    label: "Target Price",
    description: "Settles when the pair crosses a specific price.",
  },
  {
    type: "PERCENT",
    label: "% Change",
    description: "Settles on a move up or down from the start price.",
  },
  {
    type: "RANGE",
    label: "Range",
    description: "Settles if the expiry price lands inside a band.",
  },
] as const;

export default function ConditionBuilderStep({
  value,
  onChange,
  errors,
}: {
  value: ConditionForm;
  onChange: (value: ConditionForm) => void;
  errors: StepErrors;
}) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-950">Condition Builder</h2>
        <p className="mt-1 text-sm text-gray-600">
          Define exactly what must be true for your call to win.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {conditionOptions.map((option) => {
          const active = value.type === option.type;

          return (
            <button
              key={option.type}
              type="button"
              onClick={() => onChange({ ...value, type: option.type })}
              className={[
                "rounded-lg border p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50",
                active
                  ? "border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100"
                  : "border-gray-200 bg-white",
              ].join(" ")}
            >
              <div className="font-semibold text-gray-950">{option.label}</div>
              <div className="mt-2 text-xs leading-5 text-gray-600">
                {option.description}
              </div>
            </button>
          );
        })}
      </div>

      {value.type === "TARGET" && (
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-800">
              Direction
            </span>
            <select
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              value={value.comparator}
              onChange={(event) =>
                onChange({
                  ...value,
                  comparator: event.target.value as ConditionForm["comparator"],
                })
              }
            >
              <option value="ABOVE">Above</option>
              <option value="BELOW">Below</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-800">
              Target price
            </span>
            <input
              type="number"
              min="0"
              step="any"
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              placeholder="75000"
              value={value.targetPrice}
              onChange={(event) =>
                onChange({ ...value, targetPrice: event.target.value })
              }
            />
            {errors.targetPrice && (
              <p className="mt-2 text-sm font-medium text-red-600">
                {errors.targetPrice}
              </p>
            )}
          </label>
        </div>
      )}

      {value.type === "PERCENT" && (
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-800">
              Direction
            </span>
            <select
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              value={value.direction}
              onChange={(event) =>
                onChange({
                  ...value,
                  direction: event.target.value as ConditionForm["direction"],
                })
              }
            >
              <option value="UP">Up</option>
              <option value="DOWN">Down</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-800">
              Percent change
            </span>
            <input
              type="number"
              min="0"
              step="any"
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              placeholder="10"
              value={value.percentChange}
              onChange={(event) =>
                onChange({ ...value, percentChange: event.target.value })
              }
            />
            {errors.percentChange && (
              <p className="mt-2 text-sm font-medium text-red-600">
                {errors.percentChange}
              </p>
            )}
          </label>
        </div>
      )}

      {value.type === "RANGE" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-800">
              Minimum price
            </span>
            <input
              type="number"
              min="0"
              step="any"
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              placeholder="65000"
              value={value.rangeMin}
              onChange={(event) =>
                onChange({ ...value, rangeMin: event.target.value })
              }
            />
            {errors.rangeMin && (
              <p className="mt-2 text-sm font-medium text-red-600">
                {errors.rangeMin}
              </p>
            )}
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-gray-800">
              Maximum price
            </span>
            <input
              type="number"
              min="0"
              step="any"
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              placeholder="72000"
              value={value.rangeMax}
              onChange={(event) =>
                onChange({ ...value, rangeMax: event.target.value })
              }
            />
            {errors.rangeMax && (
              <p className="mt-2 text-sm font-medium text-red-600">
                {errors.rangeMax}
              </p>
            )}
          </label>
        </div>
      )}
    </section>
  );
}
