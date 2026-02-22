"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UserProfile {
  /** Stellar G... address — primary key */
  publicKey: string;
  /** Optional display name (max 40 chars) */
  displayName: string;
  /** Optional bio (max 160 chars) */
  bio: string;
  /** Avatar URL or null */
  avatarUrl: string | null;
  /** ISO timestamp of last edit */
  updatedAt: string;
}

export type ProfileSaveStatus = "idle" | "saving" | "saved" | "error";

// ─── Storage helpers ─────────────────────────────────────────────────────────

const profileKey = (pk: string) => `backit_profile_${pk}`;

function loadLocalProfile(publicKey: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(profileKey(publicKey));
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

function saveLocalProfile(profile: UserProfile): void {
  localStorage.setItem(profileKey(profile.publicKey), JSON.stringify(profile));
}

// ─── API helpers (replace BASE_URL with your real backend) ───────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchRemoteProfile(
  publicKey: string,
): Promise<UserProfile | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${publicKey}`);
    if (!res.ok) return null;
    return (await res.json()) as UserProfile;
  } catch {
    return null;
  }
}

async function pushRemoteProfile(
  profile: UserProfile,
  authToken: string,
): Promise<boolean> {
  if (!API_BASE) return false;
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${profile.publicKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(profile),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Default profile factory ─────────────────────────────────────────────────

function defaultProfile(publicKey: string): UserProfile {
  return {
    publicKey,
    displayName: "",
    bio: "",
    avatarUrl: null,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useProfile(publicKey: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<ProfileSaveStatus>("idle");

  // ── Load profile whenever publicKey changes ────────────────────────────
  useEffect(() => {
    if (!publicKey) {
      setProfile(null);
      return;
    }

    setIsLoading(true);

    const load = async () => {
      // 1. Seed from localStorage immediately for fast paint
      const local = loadLocalProfile(publicKey);
      setProfile(local ?? defaultProfile(publicKey));

      // 2. Attempt remote fetch (authoritative if available)
      const remote = await fetchRemoteProfile(publicKey);
      if (remote) {
        // Remote wins if it's newer
        if (!local || remote.updatedAt > local.updatedAt) {
          setProfile(remote);
          saveLocalProfile(remote); // keep local cache warm
        }
      }

      setIsLoading(false);
    };

    load();
  }, [publicKey]);

  // ── Save profile ───────────────────────────────────────────────────────
  const saveProfile = useCallback(
    async (
      updates: Partial<Pick<UserProfile, "displayName" | "bio" | "avatarUrl">>,
    ) => {
      if (!publicKey || !profile) return;

      // Validation
      if (
        updates.displayName !== undefined &&
        updates.displayName.length > 40
      ) {
        updates.displayName = updates.displayName.slice(0, 40);
      }
      if (updates.bio !== undefined && updates.bio.length > 160) {
        updates.bio = updates.bio.slice(0, 160);
      }

      const updated: UserProfile = {
        ...profile,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      setSaveStatus("saving");
      setProfile(updated);
      saveLocalProfile(updated);

      // Optimistic: push to remote if configured
      const authToken = sessionStorage.getItem("backit_auth_token") ?? "";
      const remoteSaved = await pushRemoteProfile(updated, authToken);

      setSaveStatus(remoteSaved || !API_BASE ? "saved" : "error");

      // Reset status badge after 2.5s
      setTimeout(() => setSaveStatus("idle"), 2500);
    },
    [publicKey, profile],
  );

  // ── Clear profile (on disconnect) ─────────────────────────────────────
  const clearProfile = useCallback(() => {
    setProfile(null);
    setSaveStatus("idle");
  }, []);

  return { profile, isLoading, saveStatus, saveProfile, clearProfile };
}
