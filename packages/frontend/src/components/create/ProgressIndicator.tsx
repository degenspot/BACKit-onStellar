"use client";

import { Check } from "lucide-react";

type Step = {
  title: string;
};

export default function ProgressIndicator({
  steps,
  currentStep,
}: {
  steps: Step[];
  currentStep: number;
}) {
  return (
    <nav aria-label="Create call progress" className="overflow-x-auto pb-1">
      <ol className="flex min-w-max items-center gap-3 sm:min-w-0">
        {steps.map((step, index) => {
          const isComplete = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <li key={step.title} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
                    isComplete
                      ? "border-green-600 bg-green-600 text-white"
                      : isCurrent
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-gray-300 bg-white text-gray-500",
                  ].join(" ")}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isComplete ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span
                  className={[
                    "hidden text-sm font-medium sm:block",
                    isCurrent ? "text-gray-950" : "text-gray-500",
                  ].join(" ")}
                >
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && (
                <span
                  className={[
                    "h-px w-8 sm:w-12",
                    isComplete ? "bg-green-500" : "bg-gray-200",
                  ].join(" ")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
