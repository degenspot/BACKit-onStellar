"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import {
  TrendingUp,
  Zap,
  Users,
  Globe,
  ArrowRight,
  ChevronDown,
  Star,
  Award,
  Target,
} from "lucide-react";

// Simple fade-in hook
function useFadeIn(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, visible };
}

function FadeIn({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, visible } = useFadeIn();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

export default function HomePage() {
  const [walletConnected, setWalletConnected] = useState(false);

  return (
    <div
      style={{ fontFamily: "'DM Mono', 'Fira Code', 'Courier New', monospace" }}
      className="min-h-screen bg-[#080b14] text-white overflow-x-hidden"
    >
      {/* Google Font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&display=swap');
        
        .heading { font-family: 'Bricolage Grotesque', sans-serif; }
        
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(34,197,94,0.3), 0 0 60px rgba(34,197,94,0.1); }
          50% { box-shadow: 0 0 40px rgba(34,197,94,0.5), 0 0 100px rgba(34,197,94,0.2); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .glow-green { animation: pulse-glow 3s ease-in-out infinite; }
        .float { animation: float 6s ease-in-out infinite; }
        .shimmer-text {
          background: linear-gradient(90deg, #22c55e, #3b82f6, #22c55e, #3b82f6);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 4s linear infinite;
        }
        .ticker-wrap { overflow: hidden; }
        .ticker { display: flex; animation: ticker 20s linear infinite; }
        .grid-bg {
          background-image: 
            linear-gradient(rgba(59,130,246,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(59,130,246,0.05) 1px, transparent 1px);
          background-size: 60px 60px;
        }
        .card-hover {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card-hover:hover {
          transform: translateY(-6px);
          box-shadow: 0 20px 60px rgba(34,197,94,0.15);
        }
        .btn-primary-glow:hover {
          box-shadow: 0 0 30px rgba(34,197,94,0.5);
          transform: translateY(-2px);
        }
        .btn-primary-glow { transition: all 0.3s ease; }
      `}</style>

      {/* Nav */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4"
        style={{
          background: "rgba(8,11,20,0.85)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(59,130,246,0.1)",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #22c55e, #3b82f6)" }}
          >
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <span className="heading font-bold text-lg tracking-tight">
            BACK<span className="text-[#22c55e]">IT</span>
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-gray-400">
          <a href="#how" className="hover:text-white transition-colors">
            How it Works
          </a>
          <a href="#features" className="hover:text-white transition-colors">
            Features
          </a>
          <a href="#leaderboard" className="hover:text-white transition-colors">
            Leaderboard
          </a>
        </div>
        <button
          onClick={() => setWalletConnected(!walletConnected)}
          className="btn-primary-glow px-5 py-2.5 rounded-lg text-sm font-medium"
          style={{
            background: walletConnected
              ? "rgba(34,197,94,0.15)"
              : "linear-gradient(135deg, #22c55e, #16a34a)",
            color: walletConnected ? "#22c55e" : "white",
            border: walletConnected ? "1px solid rgba(34,197,94,0.4)" : "none",
          }}
        >
          {walletConnected ? "● Connected" : "Connect Wallet"}
        </button>
      </nav>

      {/* Live ticker */}
      <div
        className="fixed top-[65px] left-0 right-0 z-40 py-1.5 ticker-wrap"
        style={{
          background: "rgba(34,197,94,0.08)",
          borderBottom: "1px solid rgba(34,197,94,0.15)",
        }}
      >
        <div className="ticker text-xs text-[#22c55e] opacity-70 gap-8">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex gap-10 pr-10">
              <span>
                BTC/USD ↑ 67,420 <span className="text-green-400">+2.3%</span>
              </span>
              <span>
                ETH/USD ↑ 3,840 <span className="text-green-400">+1.8%</span>
              </span>
              <span>
                SOL/USD ↓ 182 <span className="text-red-400">-0.5%</span>
              </span>
              <span>
                XLM/USD ↑ 0.42 <span className="text-green-400">+5.1%</span>
              </span>
              <span>
                AVAX/USD ↑ 41.2 <span className="text-green-400">+3.2%</span>
              </span>
              <span>CALLS TODAY: 2,847 🔥</span>
              <span>PRIZE POOL: $148,000 💰</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hero */}
      <section className="relative min-h-screen flex flex-col items-center justify-center pt-28 pb-16 px-6 grid-bg">
        {/* Radial glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 40%, rgba(34,197,94,0.08) 0%, rgba(59,130,246,0.05) 50%, transparent 100%)",
          }}
        />

        {/* Floating orbs */}
        <div
          className="float absolute top-1/4 left-1/4 w-64 h-64 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(34,197,94,0.06) 0%, transparent 70%)",
            animationDelay: "0s",
          }}
        />
        <div
          className="float absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)",
            animationDelay: "2s",
          }}
        />

        <div className="relative max-w-5xl mx-auto text-center">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs mb-8"
            style={{
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.25)",
              color: "#22c55e",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            LIVE — Prediction Markets on Stellar
          </div>

          <h1 className="heading font-extrabold text-5xl md:text-7xl lg:text-8xl leading-[1.0] mb-6 tracking-tight">
            Predict With
            <br />
            <span className="shimmer-text">Your Friends.</span>
            <br />
            <span className="text-white">Win Together.</span>
          </h1>

          <p
            className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
            style={{ fontFamily: "inherit" }}
          >
            Social prediction markets where your calls earn real yield. Stake
            your conviction, compete on the leaderboard, and settle instantly
            on-chain.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={() => setWalletConnected(true)}
              className="btn-primary-glow glow-green px-8 py-4 rounded-xl font-semibold text-base flex items-center gap-2"
              style={{
                background: "linear-gradient(135deg, #22c55e, #16a34a)",
                fontFamily: "Bricolage Grotesque, sans-serif",
              }}
            >
              Launch App <ArrowRight className="w-4 h-4" />
            </button>
            <a
              href="#how"
              className="px-8 py-4 rounded-xl text-sm font-medium text-gray-300 flex items-center gap-2 hover:text-white transition-colors"
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                fontFamily: "Bricolage Grotesque, sans-serif",
              }}
            >
              How it Works <ChevronDown className="w-4 h-4" />
            </a>
          </div>

          {/* Stats bar */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-16">
            {[
              { label: "Total Volume", value: "$4.2M" },
              { label: "Active Predictors", value: "18,400" },
              { label: "Avg Win Rate", value: "61%" },
              { label: "Chains Supported", value: "4" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="heading font-bold text-2xl md:text-3xl text-white">
                  {stat.value}
                </div>
                <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Mock UI card floating */}
        <div
          className="relative mt-16 max-w-lg mx-auto w-full float"
          style={{ animationDelay: "1s" }}
        >
          <div
            className="rounded-2xl p-1"
            style={{
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.3), rgba(59,130,246,0.3))",
              boxShadow: "0 40px 80px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="rounded-2xl p-5"
              style={{
                background: "#0d1117",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-gray-500">TRENDING CALL</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: "rgba(34,197,94,0.1)",
                    color: "#22c55e",
                  }}
                >
                  +2.3x odds
                </span>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                  style={{ background: "rgba(59,130,246,0.2)" }}
                >
                  🚀
                </div>
                <div>
                  <div className="heading font-semibold text-sm">
                    BTC hits $75k before April
                  </div>
                  <div className="text-xs text-gray-500">
                    by @crypto_sage · 847 backers
                  </div>
                </div>
              </div>
              <div
                className="h-1.5 rounded-full mb-3"
                style={{ background: "rgba(255,255,255,0.1)" }}
              >
                <div
                  className="h-full rounded-full w-2/3"
                  style={{
                    background: "linear-gradient(90deg, #22c55e, #3b82f6)",
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Pool: $24,800</span>
                <span>Closes: 12d 4h</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section
        id="how"
        className="py-24 px-6"
        style={{ background: "rgba(255,255,255,0.01)" }}
      >
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="text-xs text-[#22c55e] mb-3 tracking-widest">
                THE PROCESS
              </div>
              <h2 className="heading font-bold text-4xl md:text-5xl">
                Three steps to the moon.
              </h2>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-6 relative">
            {/* Connecting line */}
            <div
              className="hidden md:block absolute top-14 left-1/3 right-1/3 h-px"
              style={{ background: "linear-gradient(90deg, #22c55e, #3b82f6)" }}
            />

            {[
              {
                icon: <Target className="w-6 h-6" />,
                step: "01",
                title: "Make Your Call",
                desc: "Browse live markets or create your own prediction. Any token, any outcome. Put your conviction on the line.",
                color: "#22c55e",
                delay: 0,
              },
              {
                icon: <Zap className="w-6 h-6" />,
                step: "02",
                title: "Stake & Compete",
                desc: "Back your call with XLM or any supported token. Friends can back you or bet against you — social markets at its finest.",
                color: "#3b82f6",
                delay: 150,
              },
              {
                icon: <Award className="w-6 h-6" />,
                step: "03",
                title: "Win & Earn",
                desc: "Markets settle instantly on-chain. Winners claim rewards automatically. Your rep grows with every correct call.",
                color: "#a855f7",
                delay: 300,
              },
            ].map((item) => (
              <FadeIn key={item.step} delay={item.delay}>
                <div
                  className="card-hover relative rounded-2xl p-6 h-full"
                  style={{
                    background: "#0d1117",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <div
                    className="absolute -top-3 -right-3 text-xs font-bold px-2 py-1 rounded-md"
                    style={{
                      background: item.color,
                      color: "white",
                      fontFamily: "Bricolage Grotesque, sans-serif",
                    }}
                  >
                    {item.step}
                  </div>
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                    style={{ background: `${item.color}18`, color: item.color }}
                  >
                    {item.icon}
                  </div>
                  <h3 className="heading font-bold text-lg mb-3">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="text-xs text-[#3b82f6] mb-3 tracking-widest">
                BUILT DIFFERENT
              </div>
              <h2 className="heading font-bold text-4xl md:text-5xl">
                Everything you need to win.
              </h2>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: <Globe className="w-5 h-5" />,
                title: "Multi-Chain",
                desc: "Trade across Stellar, Ethereum, Solana, and Avalanche from a single unified interface.",
                badge: "4 Chains",
                color: "#3b82f6",
              },
              {
                icon: <Users className="w-5 h-5" />,
                title: "Social Feed",
                desc: "Follow top predictors, copy calls, and build your reputation on the leaderboard.",
                badge: "Live",
                color: "#22c55e",
              },
              {
                icon: <Zap className="w-5 h-5" />,
                title: "Instant Settlement",
                desc: "Soroban smart contracts settle markets in seconds. No waiting, no disputes.",
                badge: "<2s",
                color: "#a855f7",
              },
              {
                icon: <Star className="w-5 h-5" />,
                title: "Reputation Score",
                desc: "Your track record is on-chain. Build credibility, unlock higher stake limits.",
                badge: "On-chain",
                color: "#f59e0b",
              },
              {
                icon: <TrendingUp className="w-5 h-5" />,
                title: "Real Yield",
                desc: "Winning predictors earn from the losing side. No house cut — pure peer-to-peer.",
                badge: "0% Fee*",
                color: "#22c55e",
              },
              {
                icon: <Target className="w-5 h-5" />,
                title: "Create Markets",
                desc: "Anyone can launch a prediction market on any outcome. Permissionless and unstoppable.",
                badge: "Open",
                color: "#3b82f6",
              },
            ].map((feature, i) => (
              <FadeIn key={feature.title} delay={i * 80}>
                <div
                  className="card-hover rounded-2xl p-5 h-full"
                  style={{
                    background: "#0d1117",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{
                        background: `${feature.color}18`,
                        color: feature.color,
                      }}
                    >
                      {feature.icon}
                    </div>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: `${feature.color}18`,
                        color: feature.color,
                      }}
                    >
                      {feature.badge}
                    </span>
                  </div>
                  <h3 className="heading font-semibold text-base mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Leaderboard preview */}
      <section
        id="leaderboard"
        className="py-24 px-6"
        style={{ background: "rgba(255,255,255,0.01)" }}
      >
        <div className="max-w-3xl mx-auto">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="text-xs text-[#f59e0b] mb-3 tracking-widest">
                SOCIAL RANKINGS
              </div>
              <h2 className="heading font-bold text-4xl md:text-5xl">
                Top Predictors This Week
              </h2>
            </div>
          </FadeIn>

          <FadeIn delay={100}>
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                border: "1px solid rgba(255,255,255,0.07)",
                background: "#0d1117",
              }}
            >
              {[
                {
                  rank: 1,
                  name: "crypto_sage",
                  calls: 142,
                  winRate: 73,
                  pnl: "+$12,400",
                  medal: "🥇",
                },
                {
                  rank: 2,
                  name: "moon_caller",
                  calls: 98,
                  winRate: 69,
                  pnl: "+$8,200",
                  medal: "🥈",
                },
                {
                  rank: 3,
                  name: "stellar_pro",
                  calls: 201,
                  winRate: 66,
                  pnl: "+$6,100",
                  medal: "🥉",
                },
                {
                  rank: 4,
                  name: "defi_degen",
                  calls: 87,
                  winRate: 64,
                  pnl: "+$4,800",
                  medal: "4",
                },
                {
                  rank: 5,
                  name: "you?",
                  calls: 0,
                  winRate: 0,
                  pnl: "—",
                  medal: "5",
                  ghost: true,
                },
              ].map((p, i) => (
                <div
                  key={p.rank}
                  className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-white/[0.02]"
                  style={{
                    borderTop:
                      i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    opacity: (p as any).ghost ? 0.35 : 1,
                  }}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-lg w-6 text-center">{p.medal}</span>
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        background: (p as any).ghost
                          ? "rgba(255,255,255,0.05)"
                          : "linear-gradient(135deg, #22c55e33, #3b82f633)",
                        border: "1px solid rgba(34,197,94,0.2)",
                        color: (p as any).ghost ? "#666" : "#22c55e",
                      }}
                    >
                      {p.name.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="font-medium text-sm">@{p.name}</span>
                  </div>
                  <div className="hidden sm:flex items-center gap-8 text-sm text-gray-500">
                    <span>{p.calls > 0 ? `${p.calls} calls` : "—"}</span>
                    <span className="text-[#22c55e]">
                      {p.winRate > 0 ? `${p.winRate}% WR` : "—"}
                    </span>
                    <span
                      className="font-medium"
                      style={{
                        color: p.pnl.startsWith("+") ? "#22c55e" : "#666",
                      }}
                    >
                      {p.pnl}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(34,197,94,0.07) 0%, transparent 100%)",
          }}
        />
        <FadeIn>
          <div className="max-w-2xl mx-auto text-center relative">
            <div className="text-6xl mb-6">🔮</div>
            <h2 className="heading font-extrabold text-4xl md:text-6xl mb-6">
              Your next call
              <br />
              could change everything.
            </h2>
            <p className="text-gray-400 mb-10 text-lg">
              Join thousands of predictors already earning on BACKit. Connect
              your wallet and make your first call in under 60 seconds.
            </p>
            <button
              onClick={() => setWalletConnected(true)}
              className="btn-primary-glow glow-green px-10 py-4 rounded-xl font-semibold text-base inline-flex items-center gap-2"
              style={{
                background: "linear-gradient(135deg, #22c55e, #16a34a)",
                fontFamily: "Bricolage Grotesque, sans-serif",
              }}
            >
              Connect Wallet & Start <ArrowRight className="w-5 h-5" />
            </button>
            <p className="text-xs text-gray-600 mt-4">
              No account needed. Non-custodial. Your keys, your calls.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* Footer */}
      <footer
        className="py-8 px-6"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #22c55e, #3b82f6)",
              }}
            >
              <TrendingUp className="w-3 h-3 text-white" />
            </div>
            <span className="heading font-bold text-sm text-gray-400">
              BACK<span className="text-[#22c55e]">IT</span>
            </span>
          </div>
          <span>© 2025 BACKit. Powered by Stellar Soroban.</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-gray-400 transition-colors">
              Docs
            </a>
            <a href="#" className="hover:text-gray-400 transition-colors">
              Discord
            </a>
            <a href="#" className="hover:text-gray-400 transition-colors">
              Twitter
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
