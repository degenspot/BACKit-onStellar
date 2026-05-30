"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useWalletContext } from "./WalletContext";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/feed", label: "Feed" },
  { href: "/create", label: "Create" },
  { href: "/#leaderboard", label: "Leaderboard" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { publicKey } = useWalletContext();
  const drawerRef = useRef<HTMLDivElement>(null);

  const truncated = publicKey
    ? `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
    : null;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (open && drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="p-2 text-gray-300 hover:text-white"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>

      {open && (
        <div
          ref={drawerRef}
          className="fixed inset-0 z-50 flex flex-col bg-gray-950 px-6 pt-16 gap-6"
        >
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white"
          >
            <X size={22} />
          </button>

          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="text-xl font-medium text-gray-200 hover:text-white"
            >
              {label}
            </Link>
          ))}

          {truncated && (
            <p className="mt-auto pb-8 text-sm text-gray-500">{truncated}</p>
          )}
        </div>
      )}
    </div>
  );
}