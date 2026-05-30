import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  const { pair } = await params;
  const decodedPair = decodeURIComponent(pair).toUpperCase();
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "24H";

  // Determine base prices based on pair
  let startPrice = 100;
  let currentPrice = 110;

  if (decodedPair.includes("ETH")) {
    startPrice = 2350.00;
    currentPrice = 2450.50;
  } else if (decodedPair.includes("BTC")) {
    startPrice = 41200.00;
    currentPrice = 42000.00;
  } else if (decodedPair.includes("SOL")) {
    startPrice = 82.10;
    currentPrice = 85.50;
  }

  // Determine time duration & interval based on range
  let durationMs = 24 * 60 * 60 * 1000; // default 24H
  let intervalMs = 30 * 60 * 1000; // 30 mins

  if (range === "1H") {
    durationMs = 60 * 60 * 1000;
    intervalMs = 60 * 1000; // 1 min
  } else if (range === "7D") {
    durationMs = 7 * 24 * 60 * 60 * 1000;
    intervalMs = 4 * 60 * 60 * 1000; // 4 hours
  }

  const now = Date.now();
  const startTime = now - durationMs;
  const dataPointsCount = Math.floor(durationMs / intervalMs);
  const prices: any[] = [];

  let lastClose = startPrice;

  for (let i = 0; i <= dataPointsCount; i++) {
    const time = startTime + i * intervalMs;
    
    // Interpolate between startPrice and currentPrice, adding noise
    const progress = i / dataPointsCount;
    const basePrice = startPrice + (currentPrice - startPrice) * progress;
    const volatility = basePrice * 0.003; // 0.3% volatility
    const change = (Math.random() - 0.5) * volatility;
    
    const open = lastClose;
    let close = basePrice + change;
    
    // Make sure final close matches currentPrice exactly
    if (i === dataPointsCount) {
      close = currentPrice;
    }

    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;

    prices.push({
      time: Math.floor(time / 1000), // Unix timestamp in seconds
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      value: Number(close.toFixed(2)), // For line chart fallback
    });

    lastClose = close;
  }

  return NextResponse.json({
    pair: decodedPair,
    range,
    prices,
  }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
    }
  });
}
