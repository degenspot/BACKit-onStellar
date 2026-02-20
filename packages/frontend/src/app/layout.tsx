import './globals.css'
import { Inter } from 'next/font/google'
import { NotificationBell } from '@/components/NotificationBell'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'BACKit - Stellar Prediction Markets',
  description: 'Decentralized prediction markets on Stellar',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // TODO: replace with real wallet address from auth context once auth is implemented
  const TEST_USER_ID = process.env.NEXT_PUBLIC_TEST_USER_ID || null;

  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shadow-sm">
          <span className="text-base font-semibold text-gray-900 tracking-tight">
            BACKit
          </span>
          <NotificationBell userId={TEST_USER_ID} />
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
