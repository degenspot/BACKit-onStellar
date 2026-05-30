'use client'

import { User } from '@/types'
import { truncateAddress } from '@/lib/utils'
import { User as UserIcon, Edit, UserPlus, UserMinus, TrendingUp } from 'lucide-react'
import Link from 'next/link'

interface ProfileHeaderProps {
  user: User
  isOwnProfile: boolean
  onFollow?: () => void
  onUnfollow?: () => void
  onEditProfile?: () => void
}

export default function ProfileHeader({
  user,
  isOwnProfile,
  onFollow,
  onUnfollow,
  onEditProfile
}: ProfileHeaderProps) {
  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start space-x-4">
          <div className="w-16 h-16 bg-primary-100 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 border-2 border-primary-200">
            {user.avatarUrl ? (
              <img 
                src={user.avatarUrl} 
                alt={user.displayName || 'Avatar'} 
                className="w-full h-full object-cover"
              />
            ) : (
              <UserIcon className="w-8 h-8 text-primary-600" />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {user.displayName || 'Anonymous User'}
            </h1>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-sm text-gray-500">Stellar Address:</span>
              <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                {truncateAddress(user.address)}
              </code>
            </div>
            {user.bio && (
              <p className="text-sm text-gray-600 mt-2 max-w-md break-words">
                {user.bio}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex space-x-2 self-end sm:self-center">
          <Link
            href={`/profile/${user.address}/stakes`}
            className="flex items-center space-x-2 border border-gray-300 shadow-sm px-4 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-sm transition-colors"
          >
            <TrendingUp className="w-4 h-4" />
            <span>Portfolio</span>
          </Link>
          {isOwnProfile ? (
            <button
              onClick={onEditProfile}
              className="btn-secondary flex items-center space-x-2 border border-gray-300 shadow-sm"
            >
              <Edit className="w-4 h-4" />
              <span>Edit Profile</span>
            </button>
          ) : (
            <>
              {user.isFollowing ? (
                <button
                  onClick={onUnfollow}
                  className="btn-secondary flex items-center space-x-2 border border-gray-300"
                >
                  <UserMinus className="w-4 h-4" />
                  <span>Unfollow</span>
                </button>
              ) : (
                <button
                  onClick={onFollow}
                  className="btn-primary flex items-center space-x-2 shadow-sm"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Follow</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

