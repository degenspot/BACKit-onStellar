import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  console.error("Route error:", error);

  return (
    <div className="min-h-screen bg-[#080b14] text-white flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-4xl rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_40px_120px_rgba(34,197,94,0.18)] overflow-hidden">
        <div className="bg-[#0f172a] p-10 sm:p-14">
          <p className="text-sm uppercase tracking-[0.35em] text-emerald-300">Something went wrong</p>
          <h1 className="mt-6 text-5xl font-black tracking-tight text-white sm:text-6xl">
            Unexpected error.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
            We hit a snag while loading the page. Refresh the route or report the issue if it keeps happening.
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center justify-center rounded-full bg-[#22c55e] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#16a34a]"
            >
              Try Again
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:border-[#22c55e] hover:text-[#22c55e]"
            >
              Go Home
            </Link>
            <a
              href="https://github.com/degenspot/BACKit-onStellar/issues/new"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-transparent px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-[#22c55e] hover:text-[#22c55e]"
            >
              Report Issue
            </a>
          </div>

          <div className="mt-10 rounded-3xl border border-white/10 bg-[#111924] p-6 text-slate-300">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
              Error details
            </p>
            <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-200">
              {error.message}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
