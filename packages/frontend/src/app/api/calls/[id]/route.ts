import { NextRequest, NextResponse } from "next/server";

// Mock data that matches CallDetailData interface
const mockCalls: Record<string, any> = {
    "1": {
        id: 1,
        title: "ETH > $3000 by Dec 31",
        thesis: "# Ethereum Price Prediction\n\nI believe Ethereum will surpass $3000 by the end of the year due to:\n- Increased institutional adoption\n- Layer 2 scaling solutions\n- Upcoming network upgrades\n\n**Current price:** $2,450\n**Target:** $3,000\n**Timeframe:** Dec 31, 2024",
        tokenAddress: "0x...",
        pairId: "ETH/USDC",
        token: {
            symbol: "ETH",
            price: 2450.50,
            targetPrice: 3000
        },
        stakeToken: "USDC",
        stakeAmount: "1000",
        creatorAddress: "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
        endTime: "2024-12-31T23:59:59Z",
        resolved: false,
        stakes: {
            yes: 15000,
            no: 8500
        },
        participants: [
            {
                address: "GB7DR76FZ2Z3Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
                side: "YES",
                amount: "500",
                timestamp: "2024-01-15T10:30:00Z",
                txHash: "0xabc123def456ghi789"
            },
            {
                address: "GC8ES87GZ3Z4Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
                side: "NO",
                amount: "250",
                timestamp: "2024-01-15T09:15:00Z",
                txHash: "0xdef456ghi789jkl012"
            },
            {
                address: "GD9FT98HZ4Z5Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
                side: "YES",
                amount: "1000",
                timestamp: "2024-01-14T22:45:00Z",
                txHash: "0xghi789jkl012mno345"
            }
        ],
        condition: "ETH price > $3000 at 23:59:59 UTC on Dec 31, 2024",
        conditionJson: {
            token: "ETH",
            targetPrice: 3000,
            comparison: ">",
            deadline: "2024-12-31T23:59:59Z"
        },
        startPrice: 2350.00,
        createdAt: "2024-01-14T00:00:00Z"
    },
    "2": {
        id: 2,
        title: "BTC will hit $50k by end of month",
        thesis: "# Bitcoin Bull Run\n\nBitcoin will break $50k in Q1 2024 based on:\n- Halving event anticipation\n- Institutional ETF inflows\n- Macroeconomic factors\n\n**Current price:** $42,000\n**Target:** $50,000\n**Timeframe:** End of month",
        tokenAddress: "0x...",
        pairId: "BTC/USDC",
        token: {
            symbol: "BTC",
            price: 42000.00,
            targetPrice: 50000
        },
        stakeToken: "USDC",
        stakeAmount: "2000",
        creatorAddress: "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
        endTime: "2024-02-29T23:59:59Z",
        resolved: false,
        stakes: {
            yes: 25000,
            no: 12000
        },
        participants: [
            {
                address: "GE0GU10HZ5Z6Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
                side: "YES",
                amount: "1000",
                timestamp: "2024-01-14T22:45:00Z",
                txHash: "0xghi789jkl012mno345"
            },
            {
                address: "GF1HV21IZ6Z7Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
                side: "NO",
                amount: "500",
                timestamp: "2024-01-14T20:30:00Z",
                txHash: "0xjkl012mno345pqr678"
            }
        ],
        condition: "BTC price > $50,000 at 23:59:59 UTC on Feb 29, 2024",
        conditionJson: {
            token: "BTC",
            targetPrice: 50000,
            comparison: ">",
            deadline: "2024-02-29T23:59:59Z"
        },
        startPrice: 41200.00,
        createdAt: "2024-01-13T00:00:00Z"
    },
    "3": {
        id: 3,
        title: "SOL will break $100 resistance",
        thesis: "# Solana Momentum\n\nSOL is poised to break $100 due to:\n- Growing ecosystem\n- High transaction throughput\n- Increasing developer activity\n\n**Current price:** $85.50\n**Target:** $100\n**Timeframe:** Next 2 days",
        tokenAddress: "0x...",
        pairId: "SOL/USDC",
        token: {
            symbol: "SOL",
            price: 85.50,
            targetPrice: 100
        },
        stakeToken: "USDC",
        stakeAmount: "1500",
        creatorAddress: "GD3DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
        endTime: "2024-01-20T23:59:59Z",
        resolved: false,
        stakes: {
            yes: 18000,
            no: 9000
        },
        participants: [
            {
                address: "GG2JW32JZ7Z8Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
                side: "YES",
                amount: "750",
                timestamp: "2024-01-15T14:20:00Z",
                txHash: "0xmno345pqr678stu901"
            },
            {
                address: "GH3KX43KZ8Z9Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
                side: "NO",
                amount: "300",
                timestamp: "2024-01-15T12:45:00Z",
                txHash: "0xpqr678stu901vwx234"
            },
            {
                address: "GI4LY54LZ9ZAY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
                side: "YES",
                amount: "425",
                timestamp: "2024-01-15T09:10:00Z",
                txHash: "0xstu901vwx234yz567"
            }
        ],
        condition: "SOL price > $100 at 23:59:59 UTC on Jan 20, 2024",
        conditionJson: {
            token: "SOL",
            targetPrice: 100,
            comparison: ">",
            deadline: "2024-01-20T23:59:59Z"
        },
        startPrice: 82.10,
        createdAt: "2024-01-14T06:00:00Z"
    },
};

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    // Simulate network delay (remove in production)
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const { id } = await params;
    const call = mockCalls[id];

    if (!call) {
        return NextResponse.json(
            { error: "Call not found", requestedId: id }, 
            { status: 404 }
        );
    }

    // Add CORS headers if needed
    return NextResponse.json(call, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
        }
    });
}

// Optional: Add POST method if you need to update calls
export async function POST() {
    return NextResponse.json(
        { error: "Method not allowed" }, 
        { status: 405 }
    );
}

