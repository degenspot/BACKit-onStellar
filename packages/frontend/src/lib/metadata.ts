import type { Metadata } from "next";
import { CallDetailData } from "@/types";

interface SeoProps {
  title: string;
  description: string;
  url?: string;
  image?: string;
}

/**
 * Generates a consistent Next.js Metadata object with Open Graph and
 * Twitter Card tags for any page.
 */
export function buildMetadata({ title, description, url, image }: SeoProps): Metadata {
  const siteName = "BACKit";
  const defaultImage = "/og-default.png";

  return {
    title: `${title} | ${siteName}`,
    description,
    openGraph: {
      title: `${title} | ${siteName}`,
      description,
      url,
      siteName,
      images: [{ url: image ?? defaultImage, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${siteName}`,
      description,
      images: [image ?? defaultImage],
    },
  };
}

/**
 * Generates metadata for a specific call/market
 */
export function buildCallMetadata(call: CallDetailData, callId: number): Metadata {
  const siteName = "BACKit";
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://backit.app";
  const callUrl = `${baseUrl}/calls/${callId}`;
  const defaultImage = "/og-default.png";
  
  const title = call.title || `Market #${callId}`;
  const description = 
    call.condition || 
    `Trade your conviction on this prediction market. YES: ${call.stakes?.yes || 0} USDC vs NO: ${call.stakes?.no || 0} USDC`;
  
  return {
    title: `${title} | ${siteName}`,
    description,
    openGraph: {
      title: `${title} | ${siteName}`,
      description,
      url: callUrl,
      siteName,
      images: [{ url: defaultImage, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${siteName}`,
      description,
      images: [defaultImage],
    },
  };
}

/** Pre-built metadata for the home page. */
export const homeMetadata: Metadata = buildMetadata({
  title: "Stellar Prediction Markets",
  description: "Decentralized prediction markets on Stellar. Stake XLM on outcomes you believe in.",
  url: "https://backit.app",
});