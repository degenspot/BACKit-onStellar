"use client";

import ReactMarkdown from "react-markdown";
import type { CreateCallFormData } from "./types";

function describeCondition(form: CreateCallFormData) {
  const condition = form.condition;
  const pair = form.tokenPair?.symbol || "Selected pair";

  if (condition.type === "TARGET") {
    return `${pair} closes ${condition.comparator.toLowerCase()} ${condition.targetPrice}`;
  }

  if (condition.type === "PERCENT") {
    return `${pair} moves ${condition.direction.toLowerCase()} by ${condition.percentChange}%`;
  }

  return `${pair} closes between ${condition.rangeMin} and ${condition.rangeMax}`;
}

function formatDate(value: string) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ReviewSubmitStep({
  form,
  estimatedGasFee,
}: {
  form: CreateCallFormData;
  estimatedGasFee: string;
}) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-950">Review & Submit</h2>
        <p className="mt-1 text-sm text-gray-600">
          Confirm the market details before creating the call.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Token Pair
          </div>
          <div className="mt-2 font-semibold text-gray-950">
            {form.tokenPair?.symbol}
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {form.tokenPair?.name}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Condition
          </div>
          <div className="mt-2 font-semibold text-gray-950">
            {describeCondition(form)}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Stake
          </div>
          <div className="mt-2 font-semibold text-gray-950">
            {form.stakeAmount} {form.stakeToken}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Expiry
          </div>
          <div className="mt-2 font-semibold text-gray-950">
            {formatDate(form.expiry)}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
          Thesis
        </div>
        <div className="prose prose-sm mt-3 max-w-none text-gray-800">
          <ReactMarkdown>{form.thesis}</ReactMarkdown>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-indigo-100 bg-indigo-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-semibold text-indigo-950">
          Estimated gas fee
        </span>
        <span className="font-mono text-sm font-bold text-indigo-700">
          {estimatedGasFee}
        </span>
      </div>
    </section>
  );
}
