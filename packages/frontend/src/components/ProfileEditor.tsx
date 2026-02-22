"use client";

import { useState, useEffect } from "react";
import { useWalletContext } from "./WalletContext";
import { Check, Loader2, X, User, FileText } from "lucide-react";

interface ProfileEditorProps {
  /** If true, renders as a full-page section instead of a floating panel */
  inline?: boolean;
  onClose?: () => void;
}

export function ProfileEditor({ inline = false, onClose }: ProfileEditorProps) {
  const { profile, saveStatus, saveProfile, publicKey } = useWalletContext();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // Sync form state when profile loads
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setIsDirty(false);
    }
  }, [profile]);

  const handleSave = async () => {
    if (!isDirty) return;
    await saveProfile({ displayName: displayName.trim(), bio: bio.trim() });
    setIsDirty(false);
  };

  const statusIcon = () => {
    if (saveStatus === "saving")
      return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
    if (saveStatus === "saved")
      return <Check className="w-4 h-4 text-[#22c55e]" />;
    if (saveStatus === "error") return <X className="w-4 h-4 text-red-400" />;
    return null;
  };

  const statusText = () => {
    if (saveStatus === "saving") return "Saving…";
    if (saveStatus === "saved") return "Saved";
    if (saveStatus === "error") return "Save failed — try again";
    return null;
  };

  const panel = (
    <div
      className="rounded-2xl p-6 w-full"
      style={{
        background: "#0d1117",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2
            className="font-bold text-lg"
            style={{ fontFamily: "Bricolage Grotesque, sans-serif" }}
          >
            Edit Profile
          </h2>
          {publicKey && (
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              {publicKey.slice(0, 8)}…{publicKey.slice(-8)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {statusIcon()}
          {statusText() && (
            <span
              className="text-xs"
              style={{
                color:
                  saveStatus === "saved"
                    ? "#22c55e"
                    : saveStatus === "error"
                      ? "#ef4444"
                      : "#6b7280",
              }}
            >
              {statusText()}
            </span>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="ml-2 p-1.5 rounded-lg hover:bg-white/5 transition-colors text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Display Name */}
      <div className="mb-4">
        <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <User className="w-3.5 h-3.5" />
          Display Name
          <span className="ml-auto text-gray-600">{displayName.length}/40</span>
        </label>
        <input
          type="text"
          value={displayName}
          maxLength={40}
          placeholder="e.g. crypto_sage"
          onChange={(e) => {
            setDisplayName(e.target.value);
            setIsDirty(true);
          }}
          className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none transition-all"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
          onFocus={(e) =>
            (e.currentTarget.style.borderColor = "rgba(34,197,94,0.4)")
          }
          onBlur={(e) =>
            (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")
          }
        />
      </div>

      {/* Bio */}
      <div className="mb-6">
        <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <FileText className="w-3.5 h-3.5" />
          Bio
          <span className="ml-auto text-gray-600">{bio.length}/160</span>
        </label>
        <textarea
          value={bio}
          maxLength={160}
          rows={3}
          placeholder="A short description about yourself…"
          onChange={(e) => {
            setBio(e.target.value);
            setIsDirty(true);
          }}
          className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none resize-none transition-all"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontFamily: "inherit",
          }}
          onFocus={(e) =>
            (e.currentTarget.style.borderColor = "rgba(34,197,94,0.4)")
          }
          onBlur={(e) =>
            (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")
          }
        />
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!isDirty || saveStatus === "saving"}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{
          background:
            isDirty && saveStatus !== "saving"
              ? "linear-gradient(135deg, #22c55e, #16a34a)"
              : "rgba(255,255,255,0.05)",
          color: isDirty && saveStatus !== "saving" ? "white" : "#4b5563",
          fontFamily: "Bricolage Grotesque, sans-serif",
          cursor:
            isDirty && saveStatus !== "saving" ? "pointer" : "not-allowed",
        }}
      >
        {saveStatus === "saving" ? "Saving…" : "Save Profile"}
      </button>
    </div>
  );

  if (inline) return panel;

  // Modal wrapper
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {panel}
      </div>
    </div>
  );
}
