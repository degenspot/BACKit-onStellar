"use client";

import { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Keyboard, X } from "lucide-react";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
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
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Dialog.Title className="flex items-center gap-3 text-xl font-semibold text-white">
                      <Keyboard className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                      Keyboard Shortcuts
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-slate-400">
                      Press any of these keys to move faster around BACKit.
                    </Dialog.Description>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close keyboard shortcuts"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-6 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                  {[
                    { key: "Cmd+K / Ctrl+K", description: "Open search" },
                    { key: "?", description: "Open this shortcuts guide" },
                    { key: "N", description: "Go to create call" },
                    { key: "F", description: "Go to feed" },
                    { key: "L", description: "Go to leaderboard section" },
                    { key: "Escape", description: "Close open modals or drawers" },
                  ].map((item) => (
                    <div key={item.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="font-semibold text-white">{item.key}</p>
                      <p className="text-slate-400">{item.description}</p>
                    </div>
                  ))}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
