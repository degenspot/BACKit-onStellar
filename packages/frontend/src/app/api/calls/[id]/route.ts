import { NextRequest, NextResponse } from "next/server";

const mockCalls: Record<string, any> = {
    "1": {
        id: "1",
        creator: "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
        title: "BTC will hit $50k by end of month",
        description: "Bitcoin price prediction based on market analysis",
        token: "BTC",
        condition: "price > 50000",
        stakes: "1200",
        timeRemaining: "5 days",
        participants: 12,
    },
    "2": {
        id: "2",
        creator: "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
        title: "ETH 2.0 adoption will increase 30%",
        description: "Ethereum network upgrade adoption prediction",
        token: "ETH",
        condition: "adoption_rate > 0.3",
        stakes: "400",
        timeRemaining: "EXPIRED",
        participants: 8,
    },
    "3": {
        id: "3",
        creator: "GD3DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
        title: "SOL will break $100 resistance",
        description: "Solana price technical analysis",
        token: "SOL",
        condition: "price > 100",
        stakes: "1125",
        timeRemaining: "2 days",
        participants: 15,
    },
};

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const call = mockCalls[id];

    if (!call) {
        return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    return NextResponse.json(call);
}
