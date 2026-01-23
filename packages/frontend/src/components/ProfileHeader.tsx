'use client'

import { User } from '@/types'
import { truncateAddress } from '@/lib/utils'
import { User as UserIcon, Edit, UserPlus, UserMinus } from 'lucide-react'

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
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
            <UserIcon className="w-8 h-8 text-primary-600" />
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
          </div>
        </div>
        
        <div className="flex space-x-2">
          {isOwnProfile ? (
            <button
              onClick={onEditProfile}
              className="btn-secondary flex items-center space-x-2"
            >
              <Edit className="w-4 h-4" />
              <span>Edit Profile</span>
            </button>
          ) : (
            <>
              {user.isFollowing ? (
                <button
                  onClick={onUnfollow}
                  className="btn-secondary flex items-center space-x-2"
                >
                  <UserMinus className="w-4 h-4" />
                  <span>Unfollow</span>
                </button>
              ) : (
                <button
                  onClick={onFollow}
                  className="btn-primary flex items-center space-x-2"
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
