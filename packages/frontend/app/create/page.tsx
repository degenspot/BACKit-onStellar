"use client";

import CreateCallForm from "../../components/CreateCallForm";

export default function CreatePage() {
  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Create Prediction Call</h1>
      <CreateCallForm />
    </main>
  );
}
