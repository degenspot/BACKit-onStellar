"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, LineStyle, CandlestickSeries, createSeriesMarkers } from "lightweight-charts";
import { Loader2, TrendingUp, AlertTriangle } from "lucide-react";

interface PriceChartProps {
  pairId: string;
  startPrice?: number;
  createdAt?: string; // ISO date string
  currentPrice: number;
}

export default function PriceChart({
  pairId,
  startPrice,
  createdAt,
  currentPrice,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [range, setRange] = useState<"1H" | "24H" | "7D">("24H");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pricesData, setPricesData] = useState<any[]>([]);

  // Pulsing dot coordinates
  const [dotCoords, setDotCoords] = useState<{ x: number; y: number } | null>(null);

  // Fetch price data
  useEffect(() => {
    let active = true;
    const fetchPrices = async () => {
      try {
        setLoading(true);
        setError(null);
        // Encode pairId (e.g. ETH/USDC -> ETH%2FUSDC)
        const encodedPair = encodeURIComponent(pairId);
        const res = await fetch(`/api/tokens/${encodedPair}/prices?range=${range}`);
        
        if (!res.ok) {
          throw new Error("Failed to fetch historical prices");
        }
        
        const data = await res.json();
        if (active) {
          setPricesData(data.prices || []);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || "Could not load chart data");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchPrices();

    return () => {
      active = false;
    };
  }, [pairId, range]);

  // Render & update Lightweight Chart
  useEffect(() => {
    if (!containerRef.current || loading || error || pricesData.length === 0) {
      setDotCoords(null);
      return;
    }

    const container = containerRef.current;
    
    // Create the chart with sleek dark aesthetics
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 320,
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8", // slate-400
      },
      grid: {
        vertLines: { color: "rgba(30, 41, 59, 0.4)" }, // slate-800/40
        horzLines: { color: "rgba(30, 41, 59, 0.4)" },
      },
      rightPriceScale: {
        borderColor: "rgba(51, 65, 85, 0.5)", // slate-700
        autoScale: true,
      },
      timeScale: {
        borderColor: "rgba(51, 65, 85, 0.5)",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Add Candlestick Series (Lightweight-charts v5 syntax)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", // emerald-500
      downColor: "#ef4444", // red-500
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    seriesRef.current = candlestickSeries;

    // Map and load the price data
    candlestickSeries.setData(pricesData);

    // Annotate: 1. Horizontal dashed line at Call Start Price
    if (startPrice) {
      candlestickSeries.createPriceLine({
        price: startPrice,
        color: "#f59e0b", // amber-500
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Start Price: $${startPrice.toLocaleString()}`,
      });
    }

    // Annotate: 2. Vertical marker at Call Creation Time (using lightweight-charts v5 createSeriesMarkers plugin)
    if (createdAt) {
      const createdAtUnix = Math.floor(new Date(createdAt).getTime() / 1000);
      
      // Find the closest point in historical data to place the marker
      const closestPoint = pricesData.reduce((prev, curr) => {
        return Math.abs(curr.time - createdAtUnix) < Math.abs(prev.time - createdAtUnix) ? curr : prev;
      });

      if (closestPoint) {
        createSeriesMarkers(candlestickSeries, [
          {
            time: closestPoint.time,
            position: "aboveBar",
            color: "#3b82f6", // blue-500
            shape: "arrowDown",
            text: "Call Started",
            size: 1.2,
          },
        ]);
      }
    }

    // Positioning the Pulsing Dot on the last bar
    const updateDotCoordinates = () => {
      if (pricesData.length === 0) return;
      const lastPoint = pricesData[pricesData.length - 1];
      
      // Calculate coordinates
      const x = chart.timeScale().timeToCoordinate(lastPoint.time);
      const y = candlestickSeries.priceToCoordinate(lastPoint.close);
      
      if (x !== null && y !== null) {
        setDotCoords({ x, y });
      }
    };

    // Calculate initial dot position after a short render delay
    const timer = setTimeout(updateDotCoordinates, 100);

    // Subscribe to chart visible logical range change to keep dot updated
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateDotCoordinates);

    // Handle responsiveness
    const handleResize = () => {
      chart.resize(container.clientWidth, 320);
      updateDotCoordinates();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateDotCoordinates);
      chart.removeSeries(candlestickSeries);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [pricesData, loading, error, startPrice, createdAt]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden text-slate-100">
      
      {/* Chart Header Details */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary-950/40 text-primary-400 border border-primary-800/50 rounded-lg">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                {pairId} Live Price Chart
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Powered by BACKit Oracle prices
              </p>
            </div>
          </div>
        </div>

        {/* Range Selection and Price Readout */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-xs text-slate-500 block">Current Price</span>
            <span className="text-base font-extrabold text-white tabular-nums">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-0.5 rounded-lg">
            {(["1H", "24H", "7D"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  range === r
                    ? "bg-primary-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart Area wrapper */}
      <div className="relative w-full h-[320px] flex items-center justify-center bg-slate-950/40 border border-slate-800/60 rounded-xl overflow-hidden">
        {loading && (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            <span className="text-xs text-slate-500 font-medium">Loading price feeds...</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 text-red-400 p-4 text-center">
            <AlertTriangle className="w-8 h-8" />
            <span className="text-sm font-semibold">{error}</span>
          </div>
        )}

        {!loading && !error && pricesData.length === 0 && (
          <div className="text-slate-500 text-xs">No historical data available</div>
        )}

        {/* Lightweight Charts canvas container */}
        <div ref={containerRef} className="w-full h-full" />

        {/* Pulsing dot at current price coordinate */}
        {!loading && !error && dotCoords && (
          <div
            className="absolute pointer-events-none z-10"
            style={{
              left: `${dotCoords.x}px`,
              top: `${dotCoords.y}px`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <span className="relative flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border border-slate-950"></span>
            </span>
          </div>
        )}
      </div>

      {/* Quick Legend Info */}
      {!loading && !error && (
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400 border-t border-slate-850 pt-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#f59e0b] block rounded-sm" />
            <span>Amber line = Start Price (${startPrice})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 text-blue-500 block">↓</span>
            <span>Blue Marker = Creation Date</span>
          </div>
        </div>
      )}
    </div>
  );
}
