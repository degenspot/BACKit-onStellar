"use client";

import { useState } from "react";
import { CallDetailData } from "@/types";
import PayoutCalculator from "./PayoutCalculator";

interface Props {
  call: CallDetailData;
  onStake: (amount: number, side: 'YES' | 'NO') => Promise<void>;
  odds: { yes: number; no: number } | null;
}

export default function StakingInterface({ call, onStake, odds }: Props) {
  const [amount, setAmount] = useState<string>('10');
  const [selectedSide, setSelectedSide] = useState<'YES' | 'NO' | null>(null);
  const [isStaking, setIsStaking] = useState(false);

  const handleStake = async () => {
    if (!selectedSide || !amount) return;
    
    setIsStaking(true);
    try {
      await onStake(parseFloat(amount), selectedSide);
      setAmount('10');
      setSelectedSide(null);
    } catch (error) {
      console.error('Staking failed:', error);
    } finally {
      setIsStaking(false);
    }
  };

  const numericAmount = parseFloat(amount) || 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
      <h3 className="text-xl font-bold text-gray-900 mb-8">Place Your Stake</h3>
      
      {/* Side selection */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <button
          onClick={() => setSelectedSide('YES')}
          className={`relative group overflow-hidden py-5 rounded-2xl font-bold transition-all duration-300 ${
            selectedSide === 'YES'
              ? 'bg-green-600 text-white shadow-xl shadow-green-200 scale-[1.02]'
              : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-100'
          }`}
        >
          <div className="relative z-10 flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80 mb-2">Market YES</span>
            <span className="text-3xl font-black">{odds?.yes || '2.0'}x</span>
          </div>
          {selectedSide === 'YES' && (
            <div className="absolute inset-0 bg-gradient-to-tr from-green-600 to-emerald-400 opacity-100" />
          )}
        </button>

        <button
          onClick={() => setSelectedSide('NO')}
          className={`relative group overflow-hidden py-5 rounded-2xl font-bold transition-all duration-300 ${
            selectedSide === 'NO'
              ? 'bg-red-600 text-white shadow-xl shadow-red-200 scale-[1.02]'
              : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-100'
          }`}
        >
          <div className="relative z-10 flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80 mb-2">Market NO</span>
            <span className="text-3xl font-black">{odds?.no || '2.0'}x</span>
          </div>
          {selectedSide === 'NO' && (
            <div className="absolute inset-0 bg-gradient-to-tr from-red-600 to-rose-400 opacity-100" />
          )}
        </button>
      </div>

      {/* Amount input & Slider */}
      <div className="mb-10">
        <div className="flex justify-between items-end mb-4">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">
            Stake Amount (USDC)
          </label>
          <span className="text-3xl font-black text-gray-900 leading-none">${amount}</span>
        </div>
        
        <div className="slider-container relative mb-8 flex items-center h-10">
          <input
            type="range"
            min="1"
            max="1000"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full h-1.5 bg-gray-100 rounded-full appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-700 transition-all"
          />
        </div>

        <div className="grid grid-cols-4 gap-3">
          {['10', '50', '250', '500'].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className="py-2.5 text-xs font-bold border border-gray-100 rounded-xl hover:bg-indigo-50 hover:border-indigo-100 hover:text-indigo-600 transition-all text-gray-500 bg-white"
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      {/* Payout Calculator */}
      <div className="mb-10">
        <PayoutCalculator callId={call.id} amount={numericAmount} side={selectedSide} />
      </div>

      {/* Stake button */}
      <button
        onClick={handleStake}
        disabled={!selectedSide || !amount || isStaking}
        className={`w-full py-6 rounded-3xl font-black text-xl shadow-2xl transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-3 ${
          !selectedSide || !amount || isStaking
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
            : selectedSide === 'YES'
            ? 'bg-green-600 text-white hover:bg-green-700 shadow-green-500/10 hover:shadow-green-500/20'
            : 'bg-red-600 text-white hover:bg-red-700 shadow-red-500/10 hover:shadow-red-500/20'
        }`}
      >
        {isStaking ? (
          <>
            <svg className="animate-spin h-6 w-6 text-white" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Processing...
          </>
        ) : (
          `STAKE ON ${selectedSide}`
        )}
      </button>
      
      <p className="mt-6 text-[10px] text-center text-gray-400 font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2">
         <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
         Soroban Network Smart Contract v1.2.4
      </p>
    </div>
  );
}