'use client'

import { useParams } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { useWalletContext } from '@/components/WalletContext'
import ProfileHeader from '@/components/ProfileHeader'
import PortfolioDashboard from '@/components/PortfolioDashboard'
import { ProfileEditor } from '@/components/ProfileEditor'
import { Loader2 } from 'lucide-react'

export default function StakesPage() {
  const params = useParams()
  const address = params.address as string
  const { publicKey } = useWalletContext()
  
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEditingProfile, setIsEditingProfile] = useState(false)

  const isOwnProfile = !!publicKey && publicKey === address

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/users/${address}`)
      if (!res.ok) throw new Error('Failed to load profile')
      const data = await res.json()
      setProfile(data)
    } catch (err: any) {
      setError(err.message || 'Error loading profile')
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    if (address) {
      fetchProfile()
    }
  }, [address, fetchProfile])

  const handleFollow = async () => {
    try {
      const res = await fetch(`/api/users/${address}/follow`, { method: 'POST' })
      if (res.ok) {
        setProfile((prev: any) => {
          if (!prev) return prev
          return {
            ...prev,
            user: {
              ...prev.user,
              followers: prev.user.followers + 1,
              isFollowing: true
            }
          }
        })
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleUnfollow = async () => {
    try {
      const res = await fetch(`/api/users/${address}/unfollow`, { method: 'POST' })
      if (res.ok) {
        setProfile((prev: any) => {
          if (!prev) return prev
          return {
            ...prev,
            user: {
              ...prev.user,
              followers: prev.user.followers - 1,
              isFollowing: false
            }
          }
        })
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleProfileUpdate = () => {
    fetchProfile()
  }

  if (loading && !profile) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
        <p className="text-gray-500 font-medium animate-pulse">Loading profile...</p>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-center">
        <p className="text-red-500 font-bold">{error || 'Profile not found'}</p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <ProfileHeader
        user={profile.user}
        isOwnProfile={isOwnProfile}
        onFollow={handleFollow}
        onUnfollow={handleUnfollow}
        onEditProfile={() => setIsEditingProfile(true)}
      />

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-black text-gray-900 mb-6 flex items-center gap-2">
          <span>Staking Portfolio</span>
          <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-bold">Positions</span>
        </h2>
        <PortfolioDashboard address={address} />
      </div>

      {isEditingProfile && profile && (
        <ProfileEditor
          userAddress={address}
          initialDisplayName={profile.user.displayName || ''}
          initialBio={profile.user.bio || ''}
          initialAvatarUrl={profile.user.avatarUrl || null}
          onClose={() => {
            setIsEditingProfile(false)
            fetchProfile()
          }}
        />
      )}
    </div>
  )
}
