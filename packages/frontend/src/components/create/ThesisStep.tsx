"use client";

import { Bold, Italic, List, Quote } from "lucide-react";
import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { StepErrors } from "./types";

function wrapSelection(
  value: string,
  textarea: HTMLTextAreaElement | null,
  before: string,
  after = before,
) {
  if (!textarea) return `${value}${before}${after}`;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end) || "text";

  return `${value.slice(0, start)}${before}${selected}${after}${value.slice(
    end,
  )}`;
}

export default function ThesisStep({
  value,
  onChange,
  errors,
}: {
  value: string;
  onChange: (value: string) => void;
  errors: StepErrors;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const applyMarkup = (before: string, after?: string) => {
    onChange(wrapSelection(value, textareaRef.current, before, after));
  };

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-950">Thesis</h2>
        <p className="mt-1 text-sm text-gray-600">
          Explain the reasoning that backs your prediction.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-300 bg-white">
        <div className="flex flex-wrap gap-1 border-b border-gray-200 bg-gray-50 p-2">
          <button
            type="button"
            onClick={() => applyMarkup("**")}
            className="rounded-md p-2 text-gray-700 transition hover:bg-white hover:text-gray-950"
            aria-label="Bold"
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => applyMarkup("_")}
            className="rounded-md p-2 text-gray-700 transition hover:bg-white hover:text-gray-950"
            aria-label="Italic"
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => applyMarkup("- ", "")}
            className="rounded-md p-2 text-gray-700 transition hover:bg-white hover:text-gray-950"
            aria-label="Bullet list"
            title="Bullet list"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => applyMarkup("> ", "")}
            className="rounded-md p-2 text-gray-700 transition hover:bg-white hover:text-gray-950"
            aria-label="Quote"
            title="Quote"
          >
            <Quote className="h-4 w-4" />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="min-h-[180px] w-full resize-y p-4 text-gray-950 outline-none"
          placeholder="I expect BTC/USD to trade above 75,000 because..."
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>

      {errors.thesis && (
        <p className="text-sm font-medium text-red-600">{errors.thesis}</p>
      )}

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
          Preview
        </div>
        <div className="prose prose-sm max-w-none text-gray-800">
          {value.trim() ? (
            <ReactMarkdown>{value}</ReactMarkdown>
          ) : (
            <p className="text-gray-500">Your thesis preview will appear here.</p>
          )}
        </div>
      </div>
    </section>
  );
}
