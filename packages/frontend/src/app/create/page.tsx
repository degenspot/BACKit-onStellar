"use client";

import CreateCallForm from "@/components/CreateCallForm";

export default function CreatePage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl p-4 py-8 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">
          Create Prediction Call
        </h1>
        <p className="mt-2 text-gray-600">
          Build a market-ready call with clear terms, stake, and expiry.
        </p>
      </div>
      <CreateCallForm />
    </main>
  );
}
