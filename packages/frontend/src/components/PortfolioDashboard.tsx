'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  TrendingUp, 
  Wallet, 
  Award, 
  Activity, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  ChevronUp, 
  ChevronDown,
  Clock,
  ArrowUpRight,
  ArrowDownLeft
} from 'lucide-react'
import Link from 'next/link'

interface StakeCall {
  id: string;
  title: string;
  description: string;
  outcome: 'YES' | 'NO' | 'PENDING';
  resolvedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  contractAddress?: string | null;
  totalYesStake: number;
  totalNoStake: number;
}

interface StakeItem {
  id: string;
  callId: string;
  userAddress: string;
  amount: number;
  position: 'YES' | 'NO';
  profitLoss: number | null;
  transactionHash: string | null;
  createdAt: string;
  updatedAt: string;
  resolutionStatus: 'PENDING' | 'RESOLVED';
  claimed: boolean;
  call: StakeCall;
}

interface PortfolioDashboardProps {
  address: string;
}

type TabType = 'active' | 'claimable' | 'history';
type SortKey = 'date' | 'call' | 'side' | 'amount' | 'result' | 'payout';
type SortOrder = 'asc' | 'desc';

export default function PortfolioDashboard({ address }: PortfolioDashboardProps) {
  const [stakes, setStakes] = useState<StakeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Tabs
  const [activeTab, setActiveTab] = useState<TabType>('active')
  
  // Sorting history
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // Claim states
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [claimMessage, setClaimMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchStakes = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/users/${address}/stakes`)
      if (!res.ok) throw new Error('Failed to fetch portfolio stakes')
      const data = await res.json()
      setStakes(data.data || [])
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    if (address) {
      fetchStakes()
    }
  }, [address, fetchStakes])

  const handleClaim = async (stakeId: string) => {
    try {
      setClaimingId(stakeId)
      setClaimMessage(null)
      const res = await fetch(`/api/users/${address}/stakes/${stakeId}/claim`, {
        method: 'POST'
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to claim payout')
      
      setClaimMessage({ type: 'success', text: 'Payout claimed successfully!' })
      // Refresh stakes data
      await fetchStakes()
    } catch (err: any) {
      setClaimMessage({ type: 'error', text: err.message || 'Error claiming payout' })
    } finally {
      setClaimingId(null)
    }
  }

  // Calculate Summary metrics
  const activeStakes = stakes.filter(s => s.resolutionStatus === 'PENDING')
  const resolvedStakes = stakes.filter(s => s.resolutionStatus === 'RESOLVED')
  
  const totalValueLocked = activeStakes.reduce((sum, s) => sum + s.amount, 0)
  
  const wonStakes = resolvedStakes.filter(s => s.call.outcome === s.position)
  const lostStakes = resolvedStakes.filter(s => s.call.outcome !== s.position)
  
  const totalWon = wonStakes.reduce((sum, s) => sum + (s.profitLoss || 0), 0)
  const totalLost = lostStakes.reduce((sum, s) => sum + s.amount, 0)
  
  const winRate = resolvedStakes.length > 0 
    ? (wonStakes.length / resolvedStakes.length) * 100 
    : 0

  // Filter lists by tab
  const claimableStakes = stakes.filter(s => 
    s.resolutionStatus === 'RESOLVED' && 
    s.call.outcome === s.position && 
    !s.claimed
  )

  const historyStakes = stakes.filter(s => 
    s.resolutionStatus === 'RESOLVED' && 
    (s.call.outcome !== s.position || s.claimed)
  )

  // Sort history helper
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder('desc')
    }
  }

  const sortedHistory = [...historyStakes].sort((a, b) => {
    let compareA: any = ''
    let compareB: any = ''

    switch (sortKey) {
      case 'date':
        compareA = new Date(a.updatedAt).getTime()
        compareB = new Date(b.updatedAt).getTime()
        break
      case 'call':
        compareA = a.call.title.toLowerCase()
        compareB = b.call.title.toLowerCase()
        break
      case 'side':
        compareA = a.position
        compareB = b.position
        break
      case 'amount':
        compareA = a.amount
        compareB = b.amount
        break
      case 'result':
        compareA = a.call.outcome === a.position ? 1 : 0
        compareB = b.call.outcome === b.position ? 1 : 0
        break
      case 'payout':
        compareA = a.call.outcome === a.position ? (a.profitLoss || 0) : 0
        compareB = b.call.outcome === b.position ? (b.profitLoss || 0) : 0
        break
    }

    if (compareA < compareB) return sortOrder === 'asc' ? -1 : 1
    if (compareA > compareB) return sortOrder === 'asc' ? 1 : -1
    return 0
  })

  // Format date helper
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  // Calculate odds multiplier
  const getOddsMultiplier = (item: StakeItem) => {
    const total = item.call.totalYesStake + item.call.totalNoStake;
    const pool = item.position === 'YES' ? item.call.totalYesStake : item.call.totalNoStake;
    if (!pool) return '2.00x';
    return `${(total / pool).toFixed(2)}x`;
  }

  // Calculate time remaining for countdown
  const getCountdown = (expiresAt?: string | null) => {
    if (!expiresAt) return 'N/A'
    const diff = new Date(expiresAt).getTime() - Date.now()
    if (diff <= 0) return 'Ended'
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    if (days > 0) return `${days}d ${hours}h`
    return `${hours}h left`
  }

  if (loading && stakes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
        <p className="text-gray-500 font-medium animate-pulse">Loading portfolio dashboard...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Summary Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* TVL */}
        <div className="bg-gradient-to-br from-indigo-50/50 to-indigo-100/30 border border-indigo-100/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500">Value Locked</span>
            <div className="p-2 bg-indigo-100/80 text-indigo-700 rounded-xl">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-gray-900 leading-tight">
              {totalValueLocked.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-sm font-bold text-gray-400 ml-1.5 font-mono">XLM</span>
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-1">Stakes in active prediction pools</p>
          </div>
        </div>

        {/* Won */}
        <div className="bg-gradient-to-br from-emerald-50/50 to-emerald-100/30 border border-emerald-100/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500">Total Profit</span>
            <div className="p-2 bg-emerald-100/80 text-emerald-700 rounded-xl">
              <Award className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-emerald-700 leading-tight">
              +{totalWon.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-sm font-bold text-emerald-500/70 ml-1.5 font-mono">XLM</span>
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-1">Realized earnings from won stakes</p>
          </div>
        </div>

        {/* Lost */}
        <div className="bg-gradient-to-br from-rose-50/50 to-rose-100/30 border border-rose-100/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500">Total Lost</span>
            <div className="p-2 bg-rose-100/80 text-rose-700 rounded-xl">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-rose-700 leading-tight">
              -{totalLost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-sm font-bold text-rose-500/70 ml-1.5 font-mono">XLM</span>
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-1">Stakes lost in resolved markets</p>
          </div>
        </div>

        {/* Win Rate */}
        <div className="bg-gradient-to-br from-purple-50/50 to-purple-100/30 border border-purple-100/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500">Win Rate</span>
            <div className="p-2 bg-purple-100/80 text-purple-700 rounded-xl">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-gray-900 leading-tight">
              {winRate.toFixed(1)}
              <span className="text-lg font-bold text-gray-500 ml-0.5">%</span>
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-1">Ratio of correctly predicted calls</p>
          </div>
        </div>
      </div>

      {/* Claim Message notification */}
      {claimMessage && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 transition-all duration-300 animate-fadeIn ${
          claimMessage.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {claimMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <span className="font-semibold text-sm">{claimMessage.text}</span>
          <button 
            onClick={() => setClaimMessage(null)} 
            className="ml-auto text-xs font-bold hover:underline opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Tabs Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Navigation Bar */}
        <div className="flex border-b border-gray-100 bg-gray-50/50 p-2 gap-1">
          <button
            onClick={() => setActiveTab('active')}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === 'active' 
                ? 'bg-white text-indigo-700 shadow-sm border border-gray-100/85' 
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/50'
            }`}
          >
            <span>Active Stakes</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${
              activeTab === 'active' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-200/80 text-gray-600'
            }`}>
              {activeStakes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('claimable')}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === 'claimable' 
                ? 'bg-white text-indigo-700 shadow-sm border border-gray-100/85' 
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/50'
            }`}
          >
            <span>Claimable Payouts</span>
            {claimableStakes.length > 0 && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-xs ${
              activeTab === 'claimable' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200/80 text-gray-600'
            }`}>
              {claimableStakes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === 'history' 
                ? 'bg-white text-indigo-700 shadow-sm border border-gray-100/85' 
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/50'
            }`}
          >
            <span>Staking History</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${
              activeTab === 'history' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-200/80 text-gray-600'
            }`}>
              {historyStakes.length}
            </span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6">
          {/* Active Stakes List */}
          {activeTab === 'active' && (
            <div>
              {activeStakes.length === 0 ? (
                <div className="text-center py-12">
                  <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-bold">No Active Stakes found</p>
                  <p className="text-gray-400 text-sm mt-1">Predict on open calls to secure your positions.</p>
                  <Link href="/feed" className="inline-block mt-4 text-sm font-bold text-indigo-600 hover:text-indigo-700 hover:underline">
                    Browse active markets &rarr;
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {activeStakes.map(stake => (
                    <div 
                      key={stake.id} 
                      className="border border-gray-100 rounded-2xl p-5 bg-white shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group"
                    >
                      <div className="absolute top-0 left-0 w-2 h-full bg-indigo-500" />
                      
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                          Market Prediction
                        </span>
                        <div className="flex gap-2 items-center">
                          <span className="text-[10px] font-bold text-gray-400 uppercase">Ends In</span>
                          <span className="text-xs font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100">
                            {getCountdown(stake.call.expiresAt)}
                          </span>
                        </div>
                      </div>

                      <h4 className="font-bold text-gray-800 text-base leading-snug mb-4 group-hover:text-indigo-600 transition-colors">
                        <Link href={`/calls/${stake.callId}`}>
                          {stake.call.title}
                        </Link>
                      </h4>

                      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-50 bg-gray-50/30 rounded-xl p-3">
                        <div>
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Position</span>
                          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-black ${
                            stake.position === 'YES' 
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                              : 'bg-rose-50 text-rose-700 border border-rose-100'
                          }`}>
                            {stake.position === 'YES' ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                            {stake.position === 'YES' ? 'UP' : 'DOWN'}
                          </span>
                        </div>

                        <div>
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Amount</span>
                          <span className="font-bold text-gray-800 text-sm font-mono">
                            {stake.amount} <span className="text-[10px] font-normal text-gray-400">XLM</span>
                          </span>
                        </div>

                        <div>
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Current Odds</span>
                          <span className="font-bold text-indigo-700 text-sm font-mono">
                            {getOddsMultiplier(stake)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Claimable Payouts List */}
          {activeTab === 'claimable' && (
            <div>
              {claimableStakes.length === 0 ? (
                <div className="text-center py-12">
                  <Award className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-bold">No Claimable Payouts available</p>
                  <p className="text-gray-400 text-sm mt-1">Your won predictions will highlight here for you to claim your earnings.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {claimableStakes.map(stake => (
                    <div 
                      key={stake.id} 
                      className="border border-emerald-100 rounded-2xl p-5 bg-emerald-50/10 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-2 h-full bg-emerald-500" />
                      
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                            WON
                          </span>
                          <span className="text-xs font-semibold text-gray-400">
                            Resolved on {formatDate(stake.call.resolvedAt || stake.call.expiresAt || '')}
                          </span>
                        </div>
                        <h4 className="font-bold text-gray-900 text-base leading-snug">
                          <Link href={`/calls/${stake.callId}`} className="hover:text-indigo-600 transition-colors">
                            {stake.call.title}
                          </Link>
                        </h4>
                        <div className="flex gap-6 text-sm">
                          <div>
                            <span className="text-xs text-gray-400 font-semibold mr-1.5">Staked:</span>
                            <span className="font-bold text-gray-800 font-mono">{stake.amount} XLM</span>
                          </div>
                          <div>
                            <span className="text-xs text-gray-400 font-semibold mr-1.5">Est. Payout:</span>
                            <span className="font-black text-emerald-600 font-mono">{((stake.profitLoss || 0) + stake.amount).toFixed(2)} XLM</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleClaim(stake.id)}
                        disabled={claimingId === stake.id}
                        className="w-full md:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-black text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        {claimingId === stake.id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Claiming...</span>
                          </>
                        ) : (
                          <>
                            <span>Claim Payout</span>
                            <span>&rarr;</span>
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Staking History View */}
          {activeTab === 'history' && (
            <div>
              {sortedHistory.length === 0 ? (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-bold">Staking History is empty</p>
                  <p className="text-gray-400 text-sm mt-1">Completed positions and claimed payouts will appear here.</p>
                </div>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-gray-100 text-xs font-bold text-gray-400 uppercase bg-gray-50/50">
                          <th className="py-3 px-4 cursor-pointer hover:bg-gray-100 hover:text-gray-700 rounded-l-lg transition-colors" onClick={() => handleSort('date')}>
                            <div className="flex items-center gap-1">
                              <span>Date</span>
                              {sortKey === 'date' && (sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                            </div>
                          </th>
                          <th className="py-3 px-4 cursor-pointer hover:bg-gray-100 hover:text-gray-700 transition-colors" onClick={() => handleSort('call')}>
                            <div className="flex items-center gap-1">
                              <span>Call</span>
                              {sortKey === 'call' && (sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                            </div>
                          </th>
                          <th className="py-3 px-4 cursor-pointer hover:bg-gray-100 hover:text-gray-700 transition-colors" onClick={() => handleSort('side')}>
                            <div className="flex items-center gap-1">
                              <span>Side</span>
                              {sortKey === 'side' && (sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                            </div>
                          </th>
                          <th className="py-3 px-4 cursor-pointer hover:bg-gray-100 hover:text-gray-700 transition-colors" onClick={() => handleSort('amount')}>
                            <div className="flex items-center gap-1">
                              <span>Amount</span>
                              {sortKey === 'amount' && (sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                            </div>
                          </th>
                          <th className="py-3 px-4 cursor-pointer hover:bg-gray-100 hover:text-gray-700 transition-colors" onClick={() => handleSort('result')}>
                            <div className="flex items-center gap-1">
                              <span>Result</span>
                              {sortKey === 'result' && (sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                            </div>
                          </th>
                          <th className="py-3 px-4 cursor-pointer hover:bg-gray-100 hover:text-gray-700 rounded-r-lg transition-colors" onClick={() => handleSort('payout')}>
                            <div className="flex items-center gap-1">
                              <span>Payout</span>
                              {sortKey === 'payout' && (sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-sm">
                        {sortedHistory.map(item => {
                          const won = item.call.outcome === item.position;
                          return (
                            <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="py-4 px-4 font-medium text-gray-500 font-mono text-xs">
                                {formatDate(item.updatedAt)}
                              </td>
                              <td className="py-4 px-4 font-bold text-gray-900 max-w-xs truncate">
                                <Link href={`/calls/${item.callId}`} className="hover:text-indigo-600 transition-colors">
                                  {item.call.title}
                                </Link>
                              </td>
                              <td className="py-4 px-4">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-black ${
                                  item.position === 'YES' 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                    : 'bg-rose-50 text-rose-700 border border-rose-100'
                                }`}>
                                  {item.position === 'YES' ? 'UP' : 'DOWN'}
                                </span>
                              </td>
                              <td className="py-4 px-4 font-mono font-bold text-gray-800">
                                {item.amount.toFixed(2)} XLM
                              </td>
                              <td className="py-4 px-4">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                  won 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                                }`}>
                                  {won ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                  {won ? 'Won' : 'Lost'}
                                </span>
                              </td>
                              <td className={`py-4 px-4 font-mono font-bold ${won ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {won ? `+${((item.profitLoss || 0) + item.amount).toFixed(2)}` : `-${item.amount.toFixed(2)}`} XLM
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View */}
                  <div className="md:hidden space-y-4">
                    {sortedHistory.map(item => {
                      const won = item.call.outcome === item.position;
                      return (
                        <div 
                          key={item.id} 
                          className="border border-gray-100 rounded-2xl p-4 bg-white shadow-sm flex flex-col gap-3 relative overflow-hidden"
                        >
                          <div className={`absolute top-0 left-0 w-1.5 h-full ${won ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                          
                          <div className="flex justify-between items-center text-xs font-mono text-gray-400">
                            <span>{formatDate(item.updatedAt)}</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${
                              won 
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}>
                              {won ? 'Won' : 'Lost'}
                            </span>
                          </div>

                          <h5 className="font-bold text-gray-900 text-sm leading-snug">
                            <Link href={`/calls/${item.callId}`}>
                              {item.call.title}
                            </Link>
                          </h5>

                          <div className="flex justify-between items-center bg-gray-50/50 rounded-xl p-2.5 text-xs">
                            <div>
                              <span className="text-gray-400 block mb-0.5 uppercase tracking-widest text-[9px] font-bold">Side</span>
                              <span className={`font-black uppercase ${item.position === 'YES' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {item.position === 'YES' ? 'UP' : 'DOWN'}
                              </span>
                            </div>
                            
                            <div>
                              <span className="text-gray-400 block mb-0.5 uppercase tracking-widest text-[9px] font-bold">Amount</span>
                              <span className="font-bold text-gray-800 font-mono">{item.amount.toFixed(2)} XLM</span>
                            </div>

                            <div className="text-right">
                              <span className="text-gray-400 block mb-0.5 uppercase tracking-widest text-[9px] font-bold">Payout</span>
                              <span className={`font-mono font-black ${won ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {won ? `+${((item.profitLoss || 0) + item.amount).toFixed(2)}` : `-${item.amount.toFixed(2)}`} XLM
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
