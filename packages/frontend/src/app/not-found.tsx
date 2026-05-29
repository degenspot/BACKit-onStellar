import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[#080b14] text-white flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-5xl rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_40px_120px_rgba(34,197,94,0.18)] overflow-hidden">
        <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr] bg-[#0e1320] p-10 lg:p-14">
          <div className="space-y-8">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.35em] text-emerald-300">404 · Page not found</p>
              <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">
                This market is off the grid.
              </h1>
              <p className="max-w-xl text-lg leading-8 text-slate-300">
                The page you are looking for doesn’t exist anymore, or the link is incorrect.
                Head back to the feed and keep exploring the next on-chain opportunity.
              </p>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-full bg-[#22c55e] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#16a34a]"
              >
                Go Home
              </Link>
              <a
                href="https://github.com/degenspot/BACKit-onStellar/issues/new"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:border-[#22c55e] hover:text-[#22c55e]"
              >
                Report Issue
              </a>
            </div>
          </div>

          <div className="relative rounded-[28px] border border-white/10 bg-[#101827] p-8 shadow-2xl">
            <div className="absolute -top-8 right-6 h-20 w-20 rounded-full bg-gradient-to-br from-[#22c55e] to-[#3b82f6] opacity-80 blur-3xl" />
            <div className="relative z-10 flex h-full flex-col items-center justify-center gap-6 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-[#111924] border border-white/10">
                <svg className="h-14 w-14 text-[#22c55e]" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M32 8C19.85 8 10 17.85 10 30C10 42.15 19.85 52 32 52C44.15 52 54 42.15 54 30C54 17.85 44.15 8 32 8Z" stroke="currentColor" strokeWidth="3" />
                  <path d="M32 18V34" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  <path d="M32 42H32.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
              <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.35em] text-sky-300">Backed by Stellar</p>
                <h2 className="text-3xl font-semibold text-white">We couldn’t find this route.</h2>
                <p className="text-sm leading-6 text-slate-400">
                  Need help? Report the issue so we can fix navigation gaps and keep the app strong.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
