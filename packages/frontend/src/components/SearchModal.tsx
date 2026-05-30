"use client";

import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Search, X } from "lucide-react";

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onSearch: (query: string) => void;
}

export function SearchModal({ open, onClose, onSearch }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
    onClose();
  };

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
        initialFocus={inputRef}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-xl transform overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <Dialog.Title className="text-xl font-semibold text-white">
                      Search BACKit
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-slate-400">
                      Quickly navigate with Cmd+K / Ctrl+K.
                    </Dialog.Description>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close search"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <label htmlFor="search-input" className="sr-only">
                    Search query
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3">
                    <Search className="h-5 w-5 text-slate-400" aria-hidden="true" />
                    <input
                      id="search-input"
                      ref={inputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search calls, users and tokens"
                      className="w-full bg-transparent text-white outline-none placeholder:text-slate-500"
                      aria-label="Search calls, users, and tokens"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                      aria-label="Cancel search"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:opacity-95"
                      aria-label="Submit search"
                    >
                      Search
                    </button>
                  </div>
                </form>

                <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                  <p className="font-semibold text-slate-200">Tip</p>
                  <p>Use <span className="font-semibold">? </span>to open the keyboard shortcuts guide.</p>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
