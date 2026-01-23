export interface User {
  address: string
  displayName?: string
  winRate: number
  totalCalls: number
  followers: number
  following: number
  isFollowing?: boolean
}

export interface Call {
  id: string
  creator: string
  title: string
  description: string
  token: string
  condition: string
  stake: number
  startTs: number
  endTs: number
  outcome?: 'YES' | 'NO' | 'PENDING'
  finalPrice?: number
  participants: number
  totalStake: number
  contentCID?: string
}

export interface UserProfile {
  user: User
  createdCalls: Call[]
  participatedCalls: Call[]
  resolvedCalls: Call[]
}

export type TabType = 'created' | 'participated' | 'resolved'
