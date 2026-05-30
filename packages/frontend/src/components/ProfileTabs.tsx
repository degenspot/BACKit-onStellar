'use client'

import { useState } from 'react'
import { Call, TabType, User } from '@/types'
import { truncateAddress } from '@/lib/utils'
import { Clock, CheckCircle, XCircle, Users } from 'lucide-react'

interface ProfileTabsProps {
   createdCalls: Call[]
   participatedCalls: Call[]
   resolvedCalls: Call[]
   followers: User[]
   following: User[]
   followersTotal: number
   followingTotal: number
   suggestedUsers?: User[]
   onLoadMoreFollowers: () => Promise<void>
   onLoadMoreFollowing: () => Promise<void>
   onFollowToggle: (address: string, isFollowing: boolean) => Promise<void>
   loading?: boolean
   error?: string | null
}

export default function ProfileTabs({
   createdCalls,
   participatedCalls,
   resolvedCalls,
   followers,
   following,
   followersTotal,
   followingTotal,
   suggestedUsers = [],
   onLoadMoreFollowers,
   onLoadMoreFollowing,
   onFollowToggle,
   loading = false,
   error = null,
  }: ProfileTabsProps) {
   const [activeTab, setActiveTab] = useState<TabType>('created')
  const [followersPage, setFollowersPage] = useState(1)
  const [followingPage, setFollowingPage] = useState(1)

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: 'created', label: 'Created Calls', count: createdCalls.length },
    { id: 'participated', label: 'Participated', count: participatedCalls.length },
    { id: 'resolved', label: 'Resolved', count: resolvedCalls.length },
    { id: 'followers', label: 'Followers', count: followersTotal },
    { id: 'following', label: 'Following', count: followingTotal }
  ]

  const getOutcomeIcon = (outcome?: string) => {
    switch (outcome) {
      case 'YES':
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case 'NO':
        return <XCircle className="w-4 h-4 text-red-600" />
      default:
        return <Clock className="w-4 h-4 text-gray-400" />
    }
  }

  const getOutcomeColor = (outcome?: string) => {
    switch (outcome) {
      case 'YES':
        return 'text-green-600 bg-green-100'
      case 'NO':
        return 'text-red-600 bg-red-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const CallCard = ({ call }: { call: Call }) => (
    <div
      className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-medium text-gray-900">{call.title}</h3>
          <p className="text-sm text-gray-600 mt-1">{call.description}</p>

          <div className="flex items-center space-x-4 mt-3 text-sm text-gray-500">
            <span>Token: {call.token}</span>
            <span>•</span>
            <span>Stake: {call.stake}</span>
            <span>•</span>
            <div className="flex items-center space-x-1">
              <Users className="w-4 h-4" />
              <span>{call.participants}</span>
            </div>
          </div>

          <div className="flex items-center space-x-2 mt-2">
            <code className="text-xs bg-gray-100 px-2 py-1 rounded">
              {truncateAddress(call.creator)}
            </code>
            <span className="text-xs text-gray-500">
              {new Date(call.startTs * 1000).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end space-y-2">
          <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${getOutcomeColor(call.outcome)}`}>
            {getOutcomeIcon(call.outcome)}
            <span>{call.outcome || 'PENDING'}</span>
          </div>

          {call.finalPrice && (
            <span className="text-sm text-gray-600">
              Final: ${call.finalPrice}
            </span>
          )}
        </div>
      </div>
    </div>
  )

  const UserCard = ({ user }: { user: User }) => (
    <div
      className="border border-gray-200 rounded-lg p-4 flex items-center space-x-4 hover:shadow-md transition-shadow"
    >
      <div className="flex-shrink-0">
        <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
          <span className="text-gray-500">{user.displayName?.charAt(0) ?? '?'}</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex justify-between">
          <h3 className="text-lg font-medium text-gray-900">{user.displayName}</h3>
          <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${
            user.isFollowing
              ? 'text-red-600 bg-red-100 hover:bg-red-200'
              : 'text-primary-600 bg-primary-100 hover:bg-primary-200'
          }`} onClick={async () => {
              await onFollowToggle(user.address, user.isFollowing ?? false)
            }}>
            {user.isFollowing ? 'Unfollow' : 'Follow'}
          </div>
        </div>
        <p className="text-sm text-gray-500">
          Reputation: {Math.round(user.winRate * 100)}% • {user.totalCalls} calls
        </p>
      </div>
    </div>
  )

  const handleLoadMoreFollowers = async () => {
    setFollowersPage(prev => prev + 1)
    await onLoadMoreFollowers()
  }

  const handleLoadMoreFollowing = async () => {
    setFollowingPage(prev => prev + 1)
    await onLoadMoreFollowing()
  }

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200">
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 px-6" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      <div className="p-6">
        {activeTab === 'followers' && (
          <div className="space-y-4">
{followers.map((follower) => (
               <UserCard key={follower.address} user={follower} />
             ))}
            {followers.length < followersTotal && (
              <button
                onClick={handleLoadMoreFollowers}
                className="w-full py-2 px-4 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
              >
                Load More
              </button>
            )}
          </div>
        )}
        {activeTab === 'following' && (
          <div className="space-y-4">
{following.map((followed) => (
               <UserCard key={followed.address} user={followed} />
             ))}
            {following.length < followingTotal && (
              <button
                onClick={handleLoadMoreFollowing}
                className="w-full py-2 px-4 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
              >
                Load More
              </button>
            )}
          </div>
        )}
        {activeTab === 'created' && createdCalls.length > 0 && (
          <div className="space-y-4">
{createdCalls.map((call) => (
               <CallCard key={call.id} call={call} />
             ))}
          </div>
        )}
        {activeTab === 'participated' && participatedCalls.length > 0 && (
          <div className="space-y-4">
{participatedCalls.map((call) => (
               <CallCard key={call.id} call={call} />
             ))}
          </div>
        )}
        {activeTab === 'resolved' && resolvedCalls.length > 0 && (
          <div className="space-y-4">
{resolvedCalls.map((call) => (
               <CallCard key={call.id} call={call} />
             ))}
          </div>
        )}
      </div>
    </div>
  )
}