import "./globals.css";
import { Inter } from "next/font/google";
import { WalletProvider } from "@/components/WalletContext";
import { NavBar } from "@/components/NavBar";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "BACKit - Stellar Prediction Markets",
  description: "Decentralized prediction markets on Stellar",
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
          <NavBar />
          <main>{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
