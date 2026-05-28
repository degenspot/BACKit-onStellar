import "./globals.css";
import { Inter } from "next/font/google";
import { WalletProvider } from "@/components/WalletContext";
import { PlatformConfigProvider } from "@/contexts/PlatformConfigContext";
import { NavBar } from "@/components/NavBar";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "BACKit - Stellar Prediction Markets",
  description: "Decentralized prediction markets on Stellar",
  openGraph: {
    title: "BACKit - Stellar Prediction Markets",
    description: "Decentralized prediction markets on Stellar",
    type: "website",
    url: "https://backit.io",
    siteName: "BACKit",
    images: [
      {
        url: "https://backit.io/og-image.png",
        width: 1200,
        height: 630,
        alt: "BACKit - Prediction Markets",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BACKit - Stellar Prediction Markets",
    description: "Decentralized prediction markets on Stellar",
    images: ["https://backit.io/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/*
          WalletProvider must wrap everything so any child can call
          useWalletContext(). NavBar is a Client Component that reads
          the live wallet address and passes it to NotificationBell.
        */}
        <WalletProvider>
          <PlatformConfigProvider>
            <NavBar />
            <main>{children}</main>
          </PlatformConfigProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
