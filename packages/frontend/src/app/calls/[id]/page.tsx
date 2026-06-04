import { Metadata } from "next";
import CallDetailClient from "./CallDetailClient";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://backit.io";
  const title = `BACKit Market #${params.id}`;
  const description = "Predict price movements on Stellar. Join this market on BACKit.";
  const imageUrl = `${baseUrl}/api/og?id=${params.id}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${baseUrl}/calls/${params.id}`,
      siteName: "BACKit on Stellar",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: title }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function CallDetailPage({ params }: Props) {
  return <CallDetailClient id={params.id} />;
}
