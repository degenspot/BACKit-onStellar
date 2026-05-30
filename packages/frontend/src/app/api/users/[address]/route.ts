import { NextRequest, NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/mockDb'
import { UserProfile, User } from '@/types'

// Mock data for users
const mockUsers: Record<string, UserProfile> = {
  'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ': {
    user: {
      address: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
      displayName: 'Alice Trader',
      winRate: 0.75,
      totalCalls: 24,
      followers: 156,
      following: 42,
      isFollowing: false
    },
    createdCalls: [
      {
        id: '1',
        creator: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
        title: 'BTC will hit $50k by end of month',
        description: 'Bitcoin price prediction based on market analysis',
        token: 'BTC',
        condition: 'price > 50000',
        stake: 100,
        startTs: Date.now() / 1000 - 86400,
        endTs: Date.now() / 1000 + 86400 * 7,
        outcome: 'PENDING',
        participants: 12,
        totalStake: 1200
      },
      {
        id: '2',
        creator: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
        title: 'ETH 2.0 adoption will increase 30%',
        description: 'Ethereum network upgrade adoption prediction',
        token: 'ETH',
        condition: 'adoption_rate > 0.3',
        stake: 50,
        startTs: Date.now() / 1000 - 172800,
        endTs: Date.now() / 1000 - 86400,
        outcome: 'YES',
        finalPrice: 2500,
        participants: 8,
        totalStake: 400
      }
    ],
    participatedCalls: [
      {
        id: '3',
        creator: 'GD3DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
        title: 'SOL will break $100 resistance',
        description: 'Solana price technical analysis',
        token: 'SOL',
        condition: 'price > 100',
        stake: 75,
        startTs: Date.now() / 1000 - 43200,
        endTs: Date.now() / 1000 + 43200,
        outcome: 'PENDING',
        participants: 15,
        totalStake: 1125
      }
    ],
    resolvedCalls: [
      {
        id: '2',
        creator: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
        title: 'ETH 2.0 adoption will increase 30%',
        description: 'Ethereum network upgrade adoption prediction',
        token: 'ETH',
        condition: 'adoption_rate > 0.3',
        stake: 50,
        startTs: Date.now() / 1000 - 172800,
        endTs: Date.now() / 1000 - 86400,
        outcome: 'YES',
        finalPrice: 2500,
        participants: 8,
        totalStake: 400
      }
    ]
  }
}

// Mock lists for followers and following (we'll generate some mock users)
const generateMockUser = (index: number, baseAddress: string): User => {
  const addresses = [
    'GD3DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
    'GD1DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
    'GD7DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
    'GD9DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
    'GDDDQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ'
  ]
  const address = addresses[index % addresses.length] + (index * 1000).toString().slice(-3)
  return {
    address,
    displayName: `User ${index + 1}`,
    winRate: 0.5 + Math.random() * 0.5,
    totalCalls: Math.floor(Math.random() * 50),
    followers: Math.floor(Math.random() * 1000),
    following: Math.floor(Math.random() * 500),
    isFollowing: false
  }
}

const mockFollowers = Array.from({ length: 200 }, (_, i) => generateMockUser(i, 'follower'))
const mockFollowing = Array.from({ length: 150 }, (_, i) => generateMockUser(i, 'following'))

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params
  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const limit = parseInt(url.searchParams.get('limit') || '20')
  const page = parseInt(url.searchParams.get('page') || '1')

  const userProfile = getUserProfile(address)

  // If type is specified, return paginated list of followers or following
  if (type === 'followers') {
    const start = (page - 1) * limit
    const end = start + limit
    const data = mockFollowers.slice(start, end)
    return NextResponse.json({
      data,
      total: mockFollowers.length,
      page,
      limit
    })
  }

  if (type === 'following') {
    const start = (page - 1) * limit
    const end = start + limit
    const data = mockFollowing.slice(start, end)
    return NextResponse.json({
      data,
      total: mockFollowing.length,
      page,
      limit
    })
  }

  // Otherwise, return the user profile
  return NextResponse.json(userProfile)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params
  const url = new URL(request.url)
  const action = url.pathname.split('/').pop()

  const userProfile = getUserProfile(address)

  if (action === 'follow') {
    if (userProfile) {
      userProfile.user.followers += 1
      userProfile.user.isFollowing = true
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'unfollow') {
    if (userProfile) {
      userProfile.user.followers -= 1
      userProfile.user.isFollowing = false
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json(
    { error: 'Invalid action' },
    { status: 400 }
  )
}

