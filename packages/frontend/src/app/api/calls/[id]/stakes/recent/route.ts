import { NextRequest, NextResponse } from "next/server";

// Mock recent stakes per call — in production, query the DB ordered by timestamp DESC LIMIT 50
const mockStakes: Record<string, any[]> = {
  "1": [
    { address: "GB7DR76FZ2Z3Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ", side: "YES", amount: "500", timestamp: new Date(Date.now() - 2 * 60000).toISOString(), txHash: "0xabc123def456ghi789" },
    { address: "GC8ES87GZ3Z4Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ", side: "NO",  amount: "250", timestamp: new Date(Date.now() - 7 * 60000).toISOString(), txHash: "0xdef456ghi789jkl012" },
    { address: "GD9FT98HZ4Z5Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ", side: "YES", amount: "1000", timestamp: new Date(Date.now() - 15 * 60000).toISOString(), txHash: "0xghi789jkl012mno345" },
  ],
  "2": [
    { address: "GE0GU10HZ5Z6Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ", side: "YES", amount: "1000", timestamp: new Date(Date.now() - 3 * 60000).toISOString(), txHash: "0xghi789jkl012mno345" },
    { address: "GF1HV21IZ6Z7Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ", side: "NO",  amount: "500",  timestamp: new Date(Date.now() - 20 * 60000).toISOString(), txHash: "0xjkl012mno345pqr678" },
  ],
  "3": [
    { address: "GG2JW32JZ7Z8Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ", side: "YES", amount: "750", timestamp: new Date(Date.now() - 1 * 60000).toISOString(), txHash: "0xmno345pqr678stu901" },
    { address: "GH3KX43KZ8Z9Y5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ", side: "NO",  amount: "300", timestamp: new Date(Date.now() - 5 * 60000).toISOString(), txHash: "0xpqr678stu901vwx234" },
    { address: "GI4LY54LZ9ZAY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ", side: "YES", amount: "425", timestamp: new Date(Date.now() - 30 * 60000).toISOString(), txHash: "0xstu901vwx234yz567" },
  ],
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stakes = (mockStakes[id] ?? []).slice(0, 50);
  return NextResponse.json(stakes);
}
