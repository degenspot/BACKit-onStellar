"use client";

import { ArrowLeft, ArrowRight, Loader2, Send } from "lucide-react";
import { useState } from "react";
import ConditionBuilderStep from "@/components/create/ConditionBuilderStep";
import ProgressIndicator from "@/components/create/ProgressIndicator";
import ReviewSubmitStep from "@/components/create/ReviewSubmitStep";
import StakeDurationStep from "@/components/create/StakeDurationStep";
import ThesisStep from "@/components/create/ThesisStep";
import TokenSelectionStep from "@/components/create/TokenSelectionStep";
import {
  DEFAULT_CONDITION,
  type CreateCallFormData,
  type StepErrors,
} from "@/components/create/types";
import { signWithFreighter } from "@/lib/freighter";

const steps = [
  { title: "Token" },
  { title: "Condition" },
  { title: "Thesis" },
  { title: "Stake" },
  { title: "Review" },
];

const estimatedGasFee = "0.00012 XLM";

function validateStep(form: CreateCallFormData, step: number): StepErrors {
  const errors: StepErrors = {};

  if (step === 0 && !form.tokenPair) {
    errors.tokenPair = "Select a token pair to continue.";
  }

  if (step === 1) {
    const condition = form.condition;

    if (condition.type === "TARGET" && Number(condition.targetPrice) <= 0) {
      errors.targetPrice = "Enter a target price greater than zero.";
    }

    if (condition.type === "PERCENT" && Number(condition.percentChange) <= 0) {
      errors.percentChange = "Enter a percent change greater than zero.";
    }

    if (condition.type === "RANGE") {
      const min = Number(condition.rangeMin);
      const max = Number(condition.rangeMax);

      if (min <= 0) errors.rangeMin = "Enter a minimum price.";
      if (max <= 0) errors.rangeMax = "Enter a maximum price.";
      if (min > 0 && max > 0 && min >= max) {
        errors.rangeMax = "Maximum price must be greater than minimum price.";
      }
    }
  }

  if (step === 2 && form.thesis.trim().length < 30) {
    errors.thesis = "Add a thesis of at least 30 characters.";
  }

  if (step === 3) {
    if (Number(form.stakeAmount) <= 0) {
      errors.stakeAmount = "Enter a stake amount greater than zero.";
    }

    if (!form.expiry) {
      errors.expiry = "Choose an expiry date and time.";
    } else if (new Date(form.expiry).getTime() <= Date.now()) {
      errors.expiry = "Expiry must be in the future.";
    }
  }

  return errors;
}

function hasErrors(errors: StepErrors) {
  return Object.keys(errors).length > 0;
}

export default function CreateCallForm() {
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<StepErrors>({});
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<CreateCallFormData>({
    tokenPair: null,
    condition: DEFAULT_CONDITION,
    thesis: "",
    stakeAmount: "",
    stakeToken: "USDC",
    expiry: "",
  });

  const goNext = () => {
    const nextErrors = validateStep(form, currentStep);
    setErrors(nextErrors);

    if (hasErrors(nextErrors)) return;

    setErrors({});
    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
  };

  const goBack = () => {
    setErrors({});
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const handleSubmit = async () => {
    const allStepErrors = [0, 1, 2, 3].reduce<StepErrors>(
      (result, step) => ({ ...result, ...validateStep(form, step) }),
      {},
    );

    setErrors(allStepErrors);

    if (hasErrors(allStepErrors)) {
      const firstInvalidStep = [0, 1, 2, 3].find((step) =>
        hasErrors(validateStep(form, step)),
      );
      setCurrentStep(firstInvalidStep ?? 0);
      return;
    }

    setLoading(true);

    try {
      const unsignedXDR = "AAAA...";
      await signWithFreighter(unsignedXDR);
      window.location.href = "/calls/123";
    } catch {
      window.alert("Transaction failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <ProgressIndicator steps={steps} currentStep={currentStep} />

      <div className="mt-8">
        {currentStep === 0 && (
          <TokenSelectionStep
            selected={form.tokenPair}
            onSelect={(tokenPair) => {
              setForm((current) => ({ ...current, tokenPair }));
              setErrors({});
            }}
            errors={errors}
          />
        )}

        {currentStep === 1 && (
          <ConditionBuilderStep
            value={form.condition}
            onChange={(condition) => {
              setForm((current) => ({ ...current, condition }));
              setErrors({});
            }}
            errors={errors}
          />
        )}

        {currentStep === 2 && (
          <ThesisStep
            value={form.thesis}
            onChange={(thesis) => {
              setForm((current) => ({ ...current, thesis }));
              setErrors({});
            }}
            errors={errors}
          />
        )}

        {currentStep === 3 && (
          <StakeDurationStep
            stakeAmount={form.stakeAmount}
            stakeToken={form.stakeToken}
            expiry={form.expiry}
            onStakeAmountChange={(stakeAmount) => {
              setForm((current) => ({ ...current, stakeAmount }));
              setErrors({});
            }}
            onStakeTokenChange={(stakeToken) =>
              setForm((current) => ({ ...current, stakeToken }))
            }
            onExpiryChange={(expiry) => {
              setForm((current) => ({ ...current, expiry }));
              setErrors({});
            }}
            errors={errors}
          />
        )}

        {currentStep === 4 && (
          <ReviewSubmitStep form={form} estimatedGasFee={estimatedGasFee} />
        )}
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 border-t border-gray-100 pt-5 sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={currentStep === 0 || loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {currentStep < steps.length - 1 ? (
          <button
            type="button"
            onClick={goNext}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Confirming
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Confirm & Create
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
