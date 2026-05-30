"use client";

import { useState, useEffect } from "react";

const STEPS = [
  { title: "Welcome to BACKit 👋", body: "Make predictions on Stellar — stake XLM on outcomes you believe in." },
  { title: "Browse Markets", body: "Explore the Feed to find open prediction markets." },
  { title: "Understand Odds", body: "Odds update in real-time as stakes flow in on each side." },
  { title: "Place a Stake", body: "Connect your wallet, pick a side, and confirm your stake." },
  { title: "Track Results", body: "Visit your Profile to see pending and settled predictions." },
];

const STORAGE_KEY = "backit_onboarding_done";

export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  if (!visible) return null;

  const current = STEPS[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-gray-900 p-6 shadow-xl">
        <p className="mb-1 text-xs text-gray-500">Step {step + 1} of {STEPS.length}</p>
        <h2 className="mb-2 text-lg font-semibold text-white">{current.title}</h2>
        <p className="mb-6 text-sm text-gray-400">{current.body}</p>
        <div className="flex justify-between gap-3">
          {step > 0 && (
            <button onClick={() => setStep((s) => s - 1)} className="text-sm text-gray-400 hover:text-white">
              Previous
            </button>
          )}
          <button onClick={dismiss} className="ml-auto text-sm text-gray-500 hover:text-white">
            Skip Tour
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep((s) => s + 1)} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              Next
            </button>
          ) : (
            <button onClick={dismiss} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              Get Started
            </button>
          )}
        </div>
      </div>
    </div>
  );
}