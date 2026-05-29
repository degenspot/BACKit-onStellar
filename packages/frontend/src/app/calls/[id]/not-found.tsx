import Link from "next/link";

export default function CallNotFoundPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="min-h-screen bg-[#080b14] text-white flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-4xl rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_40px_120px_rgba(34,197,94,0.18)] overflow-hidden">
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] bg-[#0e1320] p-10 sm:p-14">
          <div className="space-y-6">
            <p className="text-sm uppercase tracking-[0.35em] text-sky-300">Market not found</p>
            <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">
              No market matches <span className="text-[#22c55e]">{params.id}</span>.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-slate-300">
              The call you are trying to access may have been removed or never existed.
              Check the id or return to the market feed to discover active calls.
            </p>

            <div className="flex flex-col gap-4 sm:flex-row">
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-full bg-[#22c55e] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#16a34a]"
              >
                Browse Markets
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

          <div className="relative rounded-[28px] border border-white/10 bg-[#111924] p-8">
            <div className="absolute -top-8 left-8 h-20 w-20 rounded-full bg-gradient-to-br from-[#2563eb] to-[#0ea5e9] opacity-80 blur-3xl" />
            <div className="relative z-10 flex h-full flex-col items-center justify-center gap-6">
              <div className="h-24 w-24 rounded-3xl bg-[#0f172a] border border-white/10 flex items-center justify-center">
                <span className="text-6xl">📉</span>
              </div>
              <p className="text-sm text-slate-400">This call id doesn’t resolve to an active prediction market.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
