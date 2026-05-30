'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { StakeLedgerItem, UserStakesResponse, UserProfile, User } from '@/types'
import { useWalletContext } from '@/components/WalletContext'
import ProfileHeader from '@/components/ProfileHeader'
import ProfileHeaderSkeleton from '@/components/skeletons/ProfileHeaderSkeleton'
import ProfileStats from '@/components/ProfileStats'
import ProfileTabs from '@/components/ProfileTabs'
import { ProfileEditor } from '@/components/ProfileEditor'

const PAGE_SIZE = 20

function PositionTag({ position }: { position: 'YES' | 'NO' }) {
  return position === 'YES' ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
      UP
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
      DOWN
    </span>
  )
}

function StatusTag({ status, position, callOutcome }: {
  status: 'PENDING' | 'RESOLVED'
  position: 'YES' | 'NO'
  callOutcome?: 'YES' | 'NO' | 'PENDING'
}) {
  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Pending
      </span>
    )
  }

  const won = callOutcome === position
  return won ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Won
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
      Lost
    </span>
  )
}

function ProfitLossCell({ profitLoss }: { profitLoss?: number | null }) {
  if (profitLoss == null) {
    return <span className="text-gray-400 text-sm">—</span>
  }
  const positive = profitLoss >= 0
  return (
    <span className={`text-sm font-semibold ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
      {positive ? '+' : ''}{profitLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM
    </span>
  )
}

function StakeRow({ stake }: { stake: StakeLedgerItem }) {
  const callOutcome = stake.call?.outcome as 'YES' | 'NO' | 'PENDING' | undefined

  return (
    <tr className="group border-b border-gray-100 hover:bg-gray-50/70 transition-colors duration-150">
      {/* Call description */}
      <td className="py-3.5 pl-4 pr-3 sm:pl-6">
        <div className="flex flex-col gap-0.5">
          {stake.call ? (
            <Link
              href={`/calls/${stake.callId}`}
              className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors line-clamp-2 leading-snug"
            >
              {stake.call.description}
            </Link>
          ) : (
            <span className="text-sm font-medium text-gray-900 font-mono">
              {stake.callId}
            </span>
          )}
          <span className="text-xs text-gray-400">
            {new Date(stake.createdAt).toLocaleDateString(undefined, {
              year: 'numeric', month: 'short', day: 'numeric',
            })}
          </span>
        </div>
      </td>

      {/* Position */}
      <td className="py-3.5 px-3 whitespace-nowrap">
        <PositionTag position={stake.position} />
      </td>

      {/* Amount */}
      <td className="py-3.5 px-3 whitespace-nowrap">
        <span className="text-sm font-semibold text-gray-900 tabular-nums">
          {stake.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <span className="text-xs font-normal text-gray-400 ml-1">XLM</span>
        </span>
      </td>

      {/* P&L */}
      <td className="py-3.5 px-3 whitespace-nowrap">
        <ProfitLossCell profitLoss={stake.profitLoss} />
      </td>

      {/* Status */}
      <td className="py-3.5 px-3 whitespace-nowrap">
        <StatusTag
          status={stake.resolutionStatus}
          position={stake.position}
          callOutcome={callOutcome}
        />
      </td>

      {/* Tx hash */}
      <td className="py-3.5 pl-3 pr-4 sm:pr-6 whitespace-nowrap text-right">
        {stake.transactionHash ? (
          <a
            href={`https://stellar.expert/explorer/public/tx/${stake.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-indigo-500 font-mono transition-colors"
            title={stake.transactionHash}
          >
            {stake.transactionHash.slice(0, 6)}…{stake.transactionHash.slice(-4)}
          </a>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
    </tr>
  )
}

function StakeRowSkeleton() {
  return (
    <tr className="border-b border-gray-100 animate-pulse">
      <td className="py-3.5 pl-4 pr-3 sm:pl-6">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-1.5" />
        <div className="h-3 bg-gray-100 rounded w-1/3" />
      </td>
      <td className="py-3.5 px-3"><div className="h-5 bg-gray-200 rounded-full w-14" /></td>
      <td className="py-3.5 px-3"><div className="h-4 bg-gray-200 rounded w-20" /></td>
      <td className="py-3.5 px-3"><div className="h-4 bg-gray-200 rounded w-16" /></td>
      <td className="py-3.5 px-3"><div className="h-5 bg-gray-200 rounded-full w-16" /></td>
      <td className="py-3.5 pl-3 pr-4 sm:pr-6"><div className="h-3 bg-gray-200 rounded w-14 ml-auto" /></td>
    </tr>
  )
}

function EmptyState() {
  return (
    <div className="py-16 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-900">No stakes yet</p>
      <p className="text-sm text-gray-500 mt-1">Stakes you place on calls will appear here.</p>
    </div>
  )
}

function Pagination({
  page,
  total,
  limit,
  onPageChange,
}: {
  page: number
  total: number
  limit: number
  onPageChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between px-4 py-3 sm:px-6 border-t border-gray-100">
      <p className="text-sm text-gray-500">
        Showing <span className="font-medium text-gray-700">{from}–{to}</span> of{' '}
        <span className="font-medium text-gray-700">{total}</span> stakes
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className="relative inline-flex items-center px-2.5 py-1.5 text-sm font-medium text-gray-500 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          const p = i + Math.max(1, Math.min(page - 3, totalPages - 6))
          return (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`relative inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                p === page
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          )
        })}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className="relative inline-flex items-center px-2.5 py-1.5 text-sm font-medium text-gray-500 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

type StatusFilter = 'ALL' | 'PENDING' | 'RESOLVED'
type PositionFilter = 'ALL' | 'YES' | 'NO'

function FilterBar({
  status,
  position,
  onStatusChange,
  onPositionChange,
}: {
  status: StatusFilter
  position: PositionFilter
  onStatusChange: (s: StatusFilter) => void
  onPositionChange: (p: PositionFilter) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 border-b border-gray-100 bg-gray-50/50">
      {/* Status filter */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
        {(['ALL', 'PENDING', 'RESOLVED'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              status === s
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Position filter */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
        {(['ALL', 'YES', 'NO'] as PositionFilter[]).map((p) => (
          <button
            key={p}
            onClick={() => onPositionChange(p)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              position === p
                ? p === 'YES'
                  ? 'bg-emerald-600 text-white'
                  : p === 'NO'
                  ? 'bg-rose-600 text-white'
                  : 'bg-gray-900 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {p === 'ALL' ? 'All Sides' : p === 'YES' ? '↑ UP' : '↓ DOWN'}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function StakesPage() {
  const params = useParams()
  const address = params.address as string

  // Wallet Context for current logged-in address
  const { publicKey } = useWalletContext()
  const isOwnProfile = !!publicKey && publicKey === address

  // Profile data states
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [followers, setFollowers] = useState<User[]>([])
  const [following, setFollowing] = useState<User[]>([])
  const [followersTotal, setFollowersTotal] = useState(0)
  const [followingTotal, setFollowingTotal] = useState(0)
  const [followersPage, setFollowersPage] = useState(1)
  const [followingPage, setFollowingPage] = useState(1)

  // Stakes ledger states
  const [stakes, setStakes] = useState<StakeLedgerItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL')

  const fetchProfile = useCallback(async () => {
    if (!address) return
    try {
      setProfileLoading(true)
      setProfileError(null)
      const res = await fetch(`/api/users/${address}`)
      if (!res.ok) {
        setProfileError('Failed to load user profile')
        return
      }
      const data = await res.json()
      setProfile(data)
    } catch {
      setProfileError('Failed to load user profile')
    } finally {
      setProfileLoading(false)
    }
  }, [address])

  const fetchStakes = useCallback(async (p: number) => {
    if (!address) return
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams({
        page: String(p),
        limit: String(PAGE_SIZE),
      })

      const res = await fetch(`/api/users/${address}/stakes?${params}`)

      if (!res.ok) {
        setError(res.status === 404 ? 'User not found' : 'Failed to load stakes')
        return
      }

      const data: UserStakesResponse = await res.json()
      setStakes(data.data)
      setTotal(data.total)
    } catch {
      setError('Failed to load stakes')
    } finally {
      setLoading(false)
    }
  }, [address])

  const fetchFollowers = useCallback(async (p: number) => {
    if (!address) return
    try {
      const params = new URLSearchParams({
        type: 'followers',
        page: String(p),
        limit: String(PAGE_SIZE),
      })
      const res = await fetch(`/api/users/${address}?${params}`)
      if (!res.ok) return

      const data = (await res.json()) as {
        data: User[]
        total: number
        page: number
        limit: number
      }

      setFollowers((prev) => (p === 1 ? data.data : [...prev, ...data.data]))
      setFollowersTotal(data.total)
    } catch (err) {
      console.error('Failed to load followers', err)
    }
  }, [address])

  const fetchFollowing = useCallback(async (p: number) => {
    if (!address) return
    try {
      const params = new URLSearchParams({
        type: 'following',
        page: String(p),
        limit: String(PAGE_SIZE),
      })
      const res = await fetch(`/api/users/${address}?${params}`)
      if (!res.ok) return

      const data = (await res.json()) as {
        data: User[]
        total: number
        page: number
        limit: number
      }

      setFollowing((prev) => (p === 1 ? data.data : [...prev, ...data.data]))
      setFollowingTotal(data.total)
    } catch (err) {
      console.error('Failed to load following', err)
    }
  }, [address])

  const handleLoadMoreFollowers = async () => {
    const nextPage = followersPage + 1
    setFollowersPage(nextPage)
    await fetchFollowers(nextPage)
  }

  const handleLoadMoreFollowing = async () => {
    const nextPage = followingPage + 1
    setFollowingPage(nextPage)
    await fetchFollowing(nextPage)
  }

  const handleFollowToggle = async (targetAddress: string, isFollowing: boolean) => {
    const action = isFollowing ? 'unfollow' : 'follow'
    try {
      const res = await fetch(`/api/users/${targetAddress}/${action}`, { method: 'POST' })
      if (res.ok) {
        await fetchFollowers(followersPage)
        await fetchFollowing(followingPage)
      }
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    fetchProfile()
    fetchStakes(page)
  }, [fetchProfile, fetchStakes, page])

  useEffect(() => {
    setFollowersPage(1)
    setFollowingPage(1)
    fetchFollowers(1)
    fetchFollowing(1)
  }, [address, fetchFollowers, fetchFollowing])

  const handleFollow = async () => {
    if (!address) return
    try {
      const res = await fetch(`/api/users/${address}/follow`, { method: 'POST' })
      if (res.ok) {
        fetchProfile()
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleUnfollow = async () => {
    if (!address) return
    try {
      const res = await fetch(`/api/users/${address}/unfollow`, { method: 'POST' })
      if (res.ok) {
        fetchProfile()
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Client-side filter on top of the fetched page
  const filtered = stakes.filter((s) => {
    const statusMatch =
      statusFilter === 'ALL' ||
      (statusFilter === 'PENDING' && s.resolutionStatus === 'PENDING') ||
      (statusFilter === 'RESOLVED' && s.resolutionStatus === 'RESOLVED')

    const positionMatch =
      positionFilter === 'ALL' || s.position === positionFilter

    return statusMatch && positionMatch
  })

  const handlePageChange = (p: number) => {
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleStatusChange = (s: StatusFilter) => {
    setStatusFilter(s)
    setPage(1)
  }

  const handlePositionChange = (p: PositionFilter) => {
    setPositionFilter(p)
    setPage(1)
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-4 space-y-6">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500">
          <span className="text-gray-450">Profile</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-900 font-medium">Overview</span>
        </nav>

        {/* Profile Details Block */}
        {profileLoading ? (
          <div className="space-y-6">
            <ProfileHeaderSkeleton />
            {/* Tabs Skeleton */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 space-y-4">
              <div className="flex space-x-4 border-b border-gray-200 pb-3">
                <div className="h-4 w-24 rounded animate-shimmer" />
                <div className="h-4 w-24 rounded animate-shimmer" />
                <div className="h-4 w-24 rounded animate-shimmer" />
              </div>
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 rounded-xl animate-shimmer" />
                ))}
              </div>
            </div>
          </div>
        ) : profileError || !profile ? (
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 text-center text-red-500">
            {profileError || "Profile details not found"}
          </div>
        ) : (
          <>
            <ProfileHeader
              user={profile.user}
              isOwnProfile={isOwnProfile}
              onFollow={handleFollow}
              onUnfollow={handleUnfollow}
              onEditProfile={() => setIsEditingProfile(true)}
            />
            <ProfileStats user={profile.user} />
            <ProfileTabs
              createdCalls={profile.createdCalls || []}
              participatedCalls={profile.participatedCalls || []}
              resolvedCalls={profile.resolvedCalls || []}
              followers={followers}
              following={following}
              followersTotal={followersTotal}
              followingTotal={followingTotal}
              onLoadMoreFollowers={handleLoadMoreFollowers}
              onLoadMoreFollowing={handleLoadMoreFollowing}
              onFollowToggle={handleFollowToggle}
            />
          </>
        )}

        {/* Stakes Ledger table section */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-4 sm:px-6 border-b border-gray-100">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Stakes Ledger</h2>
              {!loading && !error && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {total} stake{total !== 1 ? 's' : ''} placed
                </p>
              )}
            </div>
            <button
              onClick={() => fetchStakes(page)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Refresh Stakes"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>

          {/* Filter bar */}
          <FilterBar
            status={statusFilter}
            position={positionFilter}
            onStatusChange={handleStatusChange}
            onPositionChange={handlePositionChange}
          />

          {/* Error state */}
          {error && (
            <div className="py-12 text-center">
              <p className="text-sm text-rose-600 font-medium">{error}</p>
              <button
                onClick={() => fetchStakes(page)}
                className="mt-3 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {/* Table */}
          {!error && (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="py-3 pl-4 pr-3 sm:pl-6 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Call
                      </th>
                      <th scope="col" className="py-3 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Side
                      </th>
                      <th scope="col" className="py-3 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th scope="col" className="py-3 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        P&amp;L
                      </th>
                      <th scope="col" className="py-3 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th scope="col" className="py-3 pl-3 pr-4 sm:pr-6 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Tx
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 bg-white">
                    {loading
                      ? Array.from({ length: 5 }).map((_, i) => <StakeRowSkeleton key={i} />)
                      : filtered.length === 0
                      ? (
                        <tr>
                          <td colSpan={6}>
                            <EmptyState />
                          </td>
                        </tr>
                      )
                      : filtered.map((stake) => (
                          <StakeRow key={stake.id} stake={stake} />
                        ))
                    }
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {!loading && (
                <Pagination
                  page={page}
                  total={total}
                  limit={PAGE_SIZE}
                  onPageChange={handlePageChange}
                />
              )}
            </>
          )}
        </div>

      </div>

      {/* Profile Editor Modal overlay */}
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
