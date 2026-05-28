"use client";

import { useState } from "react";
import { Share2, Twitter, Send, Copy, Check } from "lucide-react";

interface ShareButtonProps {
  callId: number;
  marketTitle: string;
  currentOdds?: { yes: number; no: number };
  compact?: boolean;
}

export default function ShareButton({
  callId,
  marketTitle,
  currentOdds,
  compact = false,
}: ShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const marketUrl = `${baseUrl}/calls/${callId}`;
  const utmUrl = `${marketUrl}?utm_source=share&utm_medium=social&utm_campaign=market_share`;

  // Track share event for analytics
  const trackShareEvent = (platform: string) => {
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "market_shared", {
        market_id: callId,
        market_title: marketTitle,
        platform: platform,
      });
    }
  };

  const handleTwitterShare = () => {
    trackShareEvent("twitter");
    const text = `🎯 Predicting: ${marketTitle}\n\nYES: ${
      currentOdds?.yes.toFixed(2) || "2.0"
    }x | NO: ${
      currentOdds?.no.toFixed(2) || "2.0"
    }x\n\nJoin the prediction on BACKit:\n${utmUrl}`;

    const encodedText = encodeURIComponent(text);
    window.open(
      `https://twitter.com/intent/tweet?text=${encodedText}`,
      "_blank",
      "width=550,height=420"
    );
    setIsOpen(false);
  };

  const handleTelegramShare = () => {
    trackShareEvent("telegram");
    const message = `🎯 <b>${marketTitle}</b>\n\n💰 <b>Odds</b>\nYES: ${
      currentOdds?.yes.toFixed(2) || "2.0"
    }x\nNO: ${
      currentOdds?.no.toFixed(2) || "2.0"
    }x\n\nPredictable. Profitable. On Stellar. 🚀\n\n${utmUrl}`;

    const encodedMessage = encodeURIComponent(message);
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(
        utmUrl
      )}&text=${encodedMessage}`,
      "_blank",
      "width=550,height=420"
    );
    setIsOpen(false);
  };

  const handleCopyLink = async () => {
    trackShareEvent("copy_link");
    try {
      await navigator.clipboard.writeText(marketUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`${
          compact
            ? "p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            : "flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition font-medium text-sm"
        }`}
        title="Share market"
      >
        <Share2 size={compact ? 18 : 16} />
        {!compact && "Share"}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <button
            onClick={handleTwitterShare}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition border-b border-gray-100 text-left"
          >
            <Twitter size={18} className="text-blue-400" />
            <span className="font-medium text-gray-900">Share on Twitter/X</span>
          </button>

          <button
            onClick={handleTelegramShare}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition border-b border-gray-100 text-left"
          >
            <Send size={18} className="text-blue-500" />
            <span className="font-medium text-gray-900">Share on Telegram</span>
          </button>

          <button
            onClick={handleCopyLink}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left"
          >
            {copied ? (
              <>
                <Check size={18} className="text-green-500" />
                <span className="font-medium text-green-600">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={18} className="text-gray-500" />
                <span className="font-medium text-gray-900">Copy Link</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Tooltip for Copy feedback */}
      {copied && (
        <div className="absolute -top-8 right-0 bg-green-500 text-white px-3 py-1 rounded-lg text-sm whitespace-nowrap">
          Copied!
        </div>
      )}
    </div>
  );
}
