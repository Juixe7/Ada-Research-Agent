"use client";

import { useEffect, useState } from "react";
import { 
  Clock, ArrowRight, Search, Globe, Lock, Layers
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { API_URL } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";

export default function HistoryArchivePage() {
  const { token } = useAuth();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/reports`, { headers })
      .then((res) => res.json())
      .then((data) => {
        if (data.reports) setReports(data.reports);
      })
      .catch((err) => console.error("Failed to load reports:", err))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = reports.filter((r) =>
    (r.query || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.executive_title || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0c0d12] text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10 md:py-16 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span>Research Archive</span>
            </div>
            <h1 className="text-3xl font-serif font-bold text-zinc-100 tracking-tight">
              Investigation Dossiers
            </h1>
            <p className="text-xs text-zinc-400">
              Publication-grade research monographs synthesized across web and vault evidence.
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3.5 top-3 text-zinc-500" />
            <input
              type="text"
              placeholder="Search dossiers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#12131a] border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-all font-sans"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center space-y-3">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin mx-auto" />
            <p className="text-xs text-zinc-500 font-mono">Reading dossiers from archive...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-12 text-center space-y-4 shadow-xl">
            <Layers className="w-10 h-10 text-zinc-600 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-200">No Research Dossiers Found</h3>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                {searchTerm ? "No research matched your query." : "Launch your first deep research investigation from the Studio."}
              </p>
            </div>
            <a
              href="/studio"
              className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-200 hover:bg-white text-zinc-950 text-xs font-medium rounded-xl transition-all"
            >
              <span>Go to Research Studio</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => (
              <div
                key={item.report_id}
                className="bg-[#12131a] hover:bg-[#161822] border border-zinc-800/80 hover:border-zinc-700/80 rounded-2xl p-5 md:p-6 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-300 font-medium uppercase border border-zinc-700/60">
                      Dossier #{item.report_id}
                    </span>
                    <span className="font-mono text-zinc-300 font-medium">
                      {item.total_sources_cited || 0} Sources Cited
                    </span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-zinc-400 font-mono text-[11px]">
                      {new Date(item.created_at * 1000).toLocaleDateString()}
                    </span>
                    {item.is_public ? (
                      <span className="text-[10px] font-mono text-zinc-300 flex items-center gap-1">
                        <Globe className="w-3 h-3 text-zinc-400" /> Public
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Private
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-semibold text-zinc-100 group-hover:text-white transition-colors leading-snug">
                    {item.executive_title || item.query}
                  </h3>

                  {item.query && item.query !== item.executive_title && (
                    <p className="text-xs text-zinc-400 line-clamp-1 italic font-serif">
                      &ldquo;{item.query}&rdquo;
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/report/${item.report_id}`}
                    className="px-4 py-2 bg-[#161822] hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-800 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5"
                  >
                    <span>Read Dossier</span>
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
