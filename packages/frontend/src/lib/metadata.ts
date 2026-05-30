import type { Metadata } from "next";

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

/** Pre-built metadata for the home page. */
export const homeMetadata: Metadata = buildMetadata({
  title: "Stellar Prediction Markets",
  description: "Decentralized prediction markets on Stellar. Stake XLM on outcomes you believe in.",
  url: "https://backit.app",
});