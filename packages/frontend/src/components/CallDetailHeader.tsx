"use client";

import { CallDetailData } from "@/types";
import ShareButton from "./ShareButton";

interface Props {
  call: CallDetailData;
  timeLeft: string;
  odds: { yes: number; no: number } | null;
}

export default function CallDetailHeader({ call, timeLeft, odds }: Props) {
  // Extract target price from condition if available
  const targetPrice = call.conditionJson?.targetPrice || call.token.price * 1.5; 
  
  return (
    <div className="bg-gradient-to-br from-[#0f172a] to-[#1e293b] text-white p-8 rounded-2xl shadow-xl shadow-slate-200 border border-slate-700">
      <div className="flex flex-col md:flex-row justify-between items-start gap-8">
        <div>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg shadow-indigo-500/20">
              {call.token.symbol[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-4xl font-black tracking-tight">{call.token.symbol}</span>
                <span className="text-slate-500 text-xl font-bold uppercase tracking-widest mt-1">/ USDC</span>
              </div>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-[0.2em] mt-1">Stellar Prediction Market</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-8 mt-10">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Target Price</p>
              <p className="text-3xl font-black text-emerald-400 leading-none">
                ${targetPrice.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Current Price</p>
              <p className="text-3xl font-black text-slate-100 leading-none">
                ${call.token.price.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="w-full md:w-auto flex md:flex-col justify-between items-end gap-10">
          <div className="text-right">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Time Remaining</p>
            <div className="text-2xl font-black text-orange-400 bg-orange-900/20 px-4 py-2 rounded-xl border border-orange-700/30">
              {timeLeft}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 leading-none">Market Multiplier</p>
                <div className="flex gap-2 mt-2">
                  <span className="bg-emerald-500/10 text-emerald-400 text-xs font-black px-3 py-1.5 rounded-lg border border-emerald-500/20 uppercase tracking-wider">YES {odds?.yes || '2.0'}x</span>
                  <span className="bg-rose-500/10 text-rose-400 text-xs font-black px-3 py-1.5 rounded-lg border border-rose-500/20 uppercase tracking-wider">NO {odds?.no || '2.0'}x</span>
                </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Creator info */}
      <div className="mt-10 pt-6 border-t border-slate-700/50 flex flex-wrap items-center justify-between gap-6 text-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-black text-xs text-slate-300">
                 {call.creatorAddress.slice(0, 1)}
              </div>
              <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1">Creator</p>
                  <p className="font-mono text-slate-300 font-bold">{call.creatorAddress.slice(0, 6)}...{call.creatorAddress.slice(-4)}</p>
              </div>
          </div>
          
          <div className="h-4 w-px bg-slate-700" />

          <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1">Contract Address</p>
              <p className="font-mono text-indigo-400 font-bold">C...{call.tokenAddress.slice(-6)}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-black px-3 py-1 rounded-full border border-indigo-500/20 uppercase tracking-widest">Protocol Participantv1.0</span>
          <ShareButton
            callId={call.id}
            marketTitle={call.title}
            currentOdds={odds || undefined}
          />
        </div>
      </div>
    </div>
  );
}