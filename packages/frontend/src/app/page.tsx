import Link from 'next/link'
import { UserPlus, TrendingUp } from 'lucide-react'

export default function HomePage() {
  const testAddress = 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            BACKit on Stellar
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Decentralized Prediction Markets Platform
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-primary-100 rounded-full">
                <TrendingUp className="w-6 h-6 text-primary-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">
                Make Predictions
              </h2>
            </div>
            <p className="text-gray-600 mb-4">
              Create and participate in prediction markets on various tokens and outcomes.
            </p>
            <Link
              href={`/profile/${testAddress}`}
              className="btn-primary inline-flex items-center space-x-2"
            >
              <UserPlus className="w-4 h-4" />
              <span>View Sample Profile</span>
            </Link>
          </div>

          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-stellar-100 rounded-full">
                <UserPlus className="w-6 h-6 text-stellar-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">
                Track Performance
              </h2>
            </div>
            <p className="text-gray-600 mb-4">
              Monitor your win rate, total calls, and social connections on the platform.
            </p>
            <Link
              href={`/profile/${testAddress}`}
              className="btn-secondary inline-flex"
            >
              View Profile Stats
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Test Profile Address
          </h3>
          <div className="bg-gray-50 p-4 rounded-lg">
            <code className="text-sm text-gray-700 break-all">
              {testAddress}
            </code>
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Click the buttons above to view a sample profile with mock data.
          </p>
        </div>
      </div>
    </div>
  )
}
