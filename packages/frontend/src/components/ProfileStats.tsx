'use client'

import { User } from '@/types'
import { formatPercentage, formatNumber } from '@/lib/utils'
import { TrendingUp, Users, MessageSquare, UserCheck } from 'lucide-react'

interface ProfileStatsProps {
  user: User
}

export default function ProfileStats({ user }: ProfileStatsProps) {
  const stats = [
    {
      label: 'Win Rate',
      value: formatPercentage(user.winRate),
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-100'
    },
    {
      label: 'Total Calls',
      value: formatNumber(user.totalCalls),
      icon: MessageSquare,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100'
    },
    {
      label: 'Followers',
      value: formatNumber(user.followers),
      icon: Users,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100'
    },
    {
      label: 'Following',
      value: formatNumber(user.following),
      icon: UserCheck,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100'
    }
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, index) => {
        const Icon = stat.icon
        return (
          <div
            key={index}
            className="bg-white rounded-lg shadow-md border border-gray-200 p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
              </div>
              <div className={`p-2 rounded-full ${stat.bgColor}`}>
                <Icon className={`w-5 h-5 ${stat.color}`} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
