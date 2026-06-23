"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
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
import { useTranslation } from "react-i18next";

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: { opacity: 1, y: 0 },
};

export default function HomePage() {
  const [walletConnected, setWalletConnected] = useState(false);
  const { t } = useTranslation();

  const howItWorks = [
    {
      icon: <Target className="h-6 w-6" />,
      step: "01",
      title: "Create a Call",
      desc: "Create a prediction market for any outcome and invite others to back your call.",
      color: "#22c55e",
    },
    {
      icon: <Zap className="h-6 w-6" />,
      step: "02",
      title: "Stake on Outcome",
      desc: "Stake your conviction on the outcome and compete with other predictors.",
      color: "#3b82f6",
    },
    {
      icon: <Award className="h-6 w-6" />,
      step: "03",
      title: "Earn Rewards",
      desc: "Win rewards when your prediction is correct and build your reputation.",
      color: "#a855f7",
    },
  ];

  const stats = [
    { label: "Total Volume", value: "$4.2M" },
    { label: "Active Markets", value: "1,240" },
    { label: "Users", value: "18.4K" },
  ];

  const features = [
    {
      icon: <Globe className="h-5 w-5" />,
      title: "Stellar Powered",
      desc: "Fast, low-cost settlement using Stellar and Soroban smart contracts.",
      badge: "Stellar",
      color: "#3b82f6",
    },
    {
      icon: <Users className="h-5 w-5" />,
      title: "Social Markets",
      desc: "Create calls, follow predictors, and compete with your community.",
      badge: "Social",
      color: "#22c55e",
    },
    {
      icon: <Zap className="h-5 w-5" />,
      title: "Fast Settlement",
      desc: "Prediction outcomes can settle quickly with a smooth user experience.",
      badge: "Fast",
      color: "#a855f7",
    },
    {
      icon: <Star className="h-5 w-5" />,
      title: "Reputation",
      desc: "Build credibility through your prediction history and win rate.",
      badge: "On-chain",
      color: "#f59e0b",
    },
    {
      icon: <TrendingUp className="h-5 w-5" />,
      title: "Market Metrics",
      desc: "Track platform activity, volume, users, and live prediction markets.",
      badge: "Live",
      color: "#22c55e",
    },
    {
      icon: <Target className="h-5 w-5" />,
      title: "Open Calls",
      desc: "Anyone can participate in prediction markets and back outcomes.",
      badge: "Open",
      color: "#3b82f6",
    },
  ];

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#080b14] text-white">
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-16px); }
        }

        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }

        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 24px rgba(34,197,94,0.25); }
          50% { box-shadow: 0 0 48px rgba(34,197,94,0.45); }
        }

        .float {
          animation: float 6s ease-in-out infinite;
        }

        .shimmer-text {
          background: linear-gradient(90deg, #22c55e, #3b82f6, #22c55e);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 4s linear infinite;
        }

        .grid-bg {
          background-image:
            linear-gradient(rgba(59,130,246,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(59,130,246,0.06) 1px, transparent 1px);
          background-size: 56px 56px;
        }

        .glow-button {
          animation: pulseGlow 3s ease-in-out infinite;
        }
      `}</style>

      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#080b14]/85 px-6 py-4 backdrop-blur-xl md:px-12">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-blue-500">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              BACK<span className="text-green-400">IT</span>
            </span>
          </Link>

          <div className="hidden items-center gap-8 text-sm text-gray-400 md:flex">
            <a href="#how" className="transition hover:text-white">
              How It Works
            </a>
            <a href="#features" className="transition hover:text-white">
              Features
            </a>
            <a href="#stats" className="transition hover:text-white">
              Stats
            </a>
          </div>

          <button
            onClick={() => setWalletConnected(!walletConnected)}
            className="rounded-xl bg-green-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-green-400"
          >
            {walletConnected ? "Connected" : "Connect Wallet"}
          </button>
        </div>
      </nav>

      <section className="grid-bg relative flex min-h-screen items-center justify-center px-6 pb-20 pt-32">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.12),transparent_45%)]" />

        <div className="float pointer-events-none absolute left-10 top-40 h-56 w-56 rounded-full bg-green-500/10 blur-3xl" />
        <div className="float pointer-events-none absolute bottom-24 right-10 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ duration: 0.7 }}
          className="relative mx-auto max-w-5xl text-center"
        >
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-green-400/30 bg-green-400/10 px-4 py-2 text-xs font-medium text-green-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
            {t("hero.badge", "Prediction Markets on Stellar")}
          </div>

          <h1 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight md:text-7xl lg:text-8xl">
            <span className="shimmer-text">{t("hero.title1", "Predict.")}</span>{" "}
            <span>{t("hero.title2", "Stake.")}</span>{" "}
            <span className="text-green-400">{t("hero.title3", "Win.")}</span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-gray-400 md:text-xl">
            BACKit is a social prediction platform where users create calls,
            stake on outcomes, and earn rewards through fast Stellar-powered
            settlement.
          </p>

          <div className="mb-16 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/calls"
              className="glow-button inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 px-8 py-4 font-semibold text-white transition hover:-translate-y-1"
            >
              Launch App <ArrowRight className="h-5 w-5" />
            </Link>

            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-8 py-4 font-medium text-gray-300 transition hover:border-white/20 hover:text-white"
            >
              How It Works <ChevronDown className="h-5 w-5" />
            </a>
          </div>

          <motion.div
            id="stats"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mx-auto grid max-w-3xl grid-cols-1 gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur sm:grid-cols-3"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-black/20 p-6">
                <div className="text-3xl font-bold">{stat.value}</div>
                <div className="mt-1 text-sm text-gray-500">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      <section id="how" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-16 text-center"
          >
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-green-400">
              How It Works
            </p>
            <h2 className="text-4xl font-bold md:text-5xl">
              Create a Call → Stake on Outcome → Earn Rewards
            </h2>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-3">
            {howItWorks.map((item, index) => (
              <motion.div
                key={item.step}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.12 }}
                className="rounded-3xl border border-white/10 bg-[#0d1117] p-7 transition hover:-translate-y-2 hover:border-green-400/30"
              >
                <div className="mb-6 flex items-center justify-between">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{
                      backgroundColor: `${item.color}20`,
                      color: item.color,
                    }}
                  >
                    {item.icon}
                  </div>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-gray-400">
                    {item.step}
                  </span>
                </div>
                <h3 className="mb-3 text-xl font-bold">{item.title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="bg-white/[0.02] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-16 text-center"
          >
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-blue-400">
              Feature Showcase
            </p>
            <h2 className="text-4xl font-bold md:text-5xl">
              Built for modern prediction markets
            </h2>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.08 }}
                className="rounded-3xl border border-white/10 bg-[#0d1117] p-6 transition hover:-translate-y-2 hover:border-blue-400/30"
              >
                <div className="mb-5 flex items-start justify-between">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl"
                    style={{
                      backgroundColor: `${feature.color}20`,
                      color: feature.color,
                    }}
                  >
                    {feature.icon}
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: `${feature.color}20`,
                      color: feature.color,
                    }}
                  >
                    {feature.badge}
                  </span>
                </div>
                <h3 className="mb-2 text-lg font-bold">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-6 py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.10),transparent_45%)]" />

        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative mx-auto max-w-3xl rounded-3xl border border-white/10 bg-[#0d1117] p-8 text-center md:p-12"
        >
          <div className="mb-5 text-5xl">🚀</div>
          <h2 className="mb-4 text-4xl font-extrabold md:text-5xl">
            Ready to make your first call?
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-gray-400">
            Launch the app, explore active markets, and start backing your
            predictions on Stellar.
          </p>
          <Link
            href="/calls"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 px-8 py-4 font-semibold text-white transition hover:-translate-y-1"
          >
            Launch App <ArrowRight className="h-5 w-5" />
          </Link>
        </motion.div>
      </section>

      <footer className="border-t border-white/10 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 text-sm text-gray-500 md:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-blue-500">
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-gray-300">
              BACK<span className="text-green-400">IT</span>
            </span>
          </div>

          <div className="rounded-full border border-green-400/30 bg-green-400/10 px-4 py-2 text-xs font-semibold text-green-400">
            Powered by Stellar
          </div>

          <div className="flex gap-5">
            <Link href="/profile/sample" className="transition hover:text-white">
              Sample Profile
            </Link>
            <a href="#features" className="transition hover:text-white">
              Features
            </a>
            <a href="#how" className="transition hover:text-white">
              How It Works
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}