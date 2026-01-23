'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { User, UserProfile } from '@/types'
import ProfileHeader from '@/components/ProfileHeader'
import ProfileStats from '@/components/ProfileStats'
import ProfileTabs from '@/components/ProfileTabs'

export default function ProfilePage() {
  const params = useParams()
  const address = params.address as string
  
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOwnProfile, setIsOwnProfile] = useState(false)

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/users/${address}`)
        
        if (!response.ok) {
          if (response.status === 404) {
            setError('User not found')
          } else {
            setError('Failed to load profile')
          }
          return
        }

        const data: UserProfile = await response.json()
        setProfile(data)
        
        setIsOwnProfile(false)
      } catch (err) {
        console.error('Error fetching profile:', err)
        setError('Failed to load profile')
      } finally {
        setLoading(false)
      }
    }

    if (address) {
      fetchProfile()
    }
  }, [address])

  const handleFollow = async () => {
    if (!profile) return
    
    try {
      setProfile((prev: UserProfile | null) => prev ? {
        ...prev,
        user: {
          ...prev.user,
          isFollowing: true,
          followers: prev.user.followers + 1
        }
      } : null)

      const response = await fetch(`/api/users/${address}/follow`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to follow user')
      }
    } catch (err) {
      console.error('Error following user:', err)
      setProfile((prev: UserProfile | null) => prev ? {
        ...prev,
        user: {
          ...prev.user,
          isFollowing: false,
          followers: prev.user.followers - 1
        }
      } : null)
    }
  }

  const handleUnfollow = async () => {
    if (!profile) return
    
    try {
      setProfile((prev: UserProfile | null) => prev ? {
        ...prev,
        user: {
          ...prev.user,
          isFollowing: false,
          followers: prev.user.followers - 1
        }
      } : null)

      const response = await fetch(`/api/users/${address}/unfollow`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to unfollow user')
      }
    } catch (err) {
      console.error('Error unfollowing user:', err)
      setProfile((prev: UserProfile | null) => prev ? {
        ...prev,
        user: {
          ...prev.user,
          isFollowing: true,
          followers: prev.user.followers + 1
        }
      } : null)
    }
  }

  const handleEditProfile = () => {
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className="animate-pulse">
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-6">
              <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white rounded-lg shadow-md border border-gray-200 p-4">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                  <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-4">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Profile Not Found</h1>
            <p className="text-gray-600 mb-4">
              {error === 'User not found' 
                ? `The user with address ${address} was not found.`
                : 'An error occurred while loading this profile.'
              }
            </p>
            <button 
              onClick={() => window.history.back()}
              className="btn-primary"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 space-y-6">
        <ProfileHeader
          user={profile.user}
          isOwnProfile={isOwnProfile}
          onFollow={handleFollow}
          onUnfollow={handleUnfollow}
          onEditProfile={handleEditProfile}
        />
        
        <ProfileStats user={profile.user} />
        
        <ProfileTabs
          createdCalls={profile.createdCalls}
          participatedCalls={profile.participatedCalls}
          resolvedCalls={profile.resolvedCalls}
        />
      </div>
    </div>
  )
}
