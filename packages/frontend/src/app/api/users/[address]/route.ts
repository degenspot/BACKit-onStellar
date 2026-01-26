import { NextRequest, NextResponse } from 'next/server'
import { UserProfile } from '@/types'

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params

  const userProfile = mockUsers[address]

  if (!userProfile) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 404 }
    )
  }

  return NextResponse.json(userProfile)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params
  const url = new URL(request.url)
  const action = url.pathname.split('/').pop()

  if (action === 'follow') {
    const userProfile = mockUsers[address]
    if (userProfile) {
      userProfile.user.followers += 1
      userProfile.user.isFollowing = true
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'unfollow') {
    const userProfile = mockUsers[address]
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
