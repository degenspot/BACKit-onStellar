"use client";

import { useEffect } from "react";

export interface KeyboardShortcutActions {
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  onNavigateCreate: () => void;
  onNavigateFeed: () => void;
  onNavigateLeaderboard: () => void;
  onCloseUI: () => void;
}

function isTextInput(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const key = event.key;

      if (key === "Escape") {
        event.preventDefault();
        actions.onCloseUI();
        window.dispatchEvent(new Event("closeAllUI"));
        return;
      }

      if (isTextInput(target)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "k") {
        event.preventDefault();
        actions.onOpenSearch();
        return;
      }

      if (key === "?") {
        event.preventDefault();
        actions.onOpenShortcuts();
        return;
      }

      if (key.toLowerCase() === "n") {
        event.preventDefault();
        actions.onNavigateCreate();
        return;
      }

      if (key.toLowerCase() === "f") {
        event.preventDefault();
        actions.onNavigateFeed();
        return;
      }

      if (key.toLowerCase() === "l") {
        event.preventDefault();
        actions.onNavigateLeaderboard();
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}
