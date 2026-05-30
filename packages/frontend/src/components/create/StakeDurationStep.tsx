"use client";

import type { StepErrors } from "./types";

const stakeTokens = ["USDC", "XLM", "AQUA", "yXLM"];

export default function StakeDurationStep({
  stakeAmount,
  stakeToken,
  expiry,
  onStakeAmountChange,
  onStakeTokenChange,
  onExpiryChange,
  errors,
}: {
  stakeAmount: string;
  stakeToken: string;
  expiry: string;
  onStakeAmountChange: (value: string) => void;
  onStakeTokenChange: (value: string) => void;
  onExpiryChange: (value: string) => void;
  errors: StepErrors;
}) {
  const minDateTime = new Date(Date.now() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-950">Stake & Duration</h2>
        <p className="mt-1 text-sm text-gray-600">
          Set the conviction amount and the time your call expires.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-gray-800">
            Stake amount
          </span>
          <input
            type="number"
            min="0"
            step="any"
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            placeholder="100"
            value={stakeAmount}
            onChange={(event) => onStakeAmountChange(event.target.value)}
          />
          {errors.stakeAmount && (
            <p className="mt-2 text-sm font-medium text-red-600">
              {errors.stakeAmount}
            </p>
          )}
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-gray-800">
            Stake token
          </span>
          <select
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            value={stakeToken}
            onChange={(event) => onStakeTokenChange(event.target.value)}
          >
            {stakeTokens.map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-gray-800">
          Expiry date and time
        </span>
        <input
          type="datetime-local"
          min={minDateTime}
          className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          value={expiry}
          onChange={(event) => onExpiryChange(event.target.value)}
        />
        {errors.expiry && (
          <p className="mt-2 text-sm font-medium text-red-600">
            {errors.expiry}
          </p>
        )}
      </label>
    </section>
  );
}
