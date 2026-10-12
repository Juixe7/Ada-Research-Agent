"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { 
  Search, ArrowRight, FolderArchive, Clock, 
  Layers, FileText, Plus, ChevronRight, HardDrive,
  BookOpen, Sparkles, Database
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/lib/config";

interface SessionItem {
  id: string;
  title: string;
  latest_query?: string;
  turn_count: number;
  updated_at: string;
}

interface VaultItem {
  doc_name: string;
  size_kb: number;
  chunk_count?: number;
}

export default function UserDashboardPage() {
  const { user, token, loading: authLoading } = useAuth();
  const router = useRouter();

  const [launcherQuery, setLauncherQuery] = useState("");
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [vaultDocs, setVaultDocs] = useState<VaultItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Guard: redirect to login if unauthenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Fetch user's sessions & vault stats
  useEffect(() => {
    if (!token) return;

    const headers = { Authorization: `Bearer ${token}` };

    Promise.all([
      fetch(`${API_URL}/api/sessions`, { headers }).then(r => r.ok ? r.json() : { sessions: [] }),
      fetch(`${API_URL}/api/vault`, { headers }).then(r => r.ok ? r.json() : { documents: [] })
    ])
      .then(([sessData, vaultData]) => {
        setSessions(sessData.sessions || []);
        setVaultDocs(vaultData.documents || []);
      })
      .catch((err) => console.warn("Dashboard fetch warning:", err))
      .finally(() => setDataLoading(false));
  }, [token]);

  const handleLaunchSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!launcherQuery.trim()) {
      router.push("/studio");
      return;
    }
    router.push(`/studio?q=${encodeURIComponent(launcherQuery.trim())}`);
  };

  // Time-aware greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  // Derived metrics
  const totalPassages = useMemo(() => {
    return vaultDocs.reduce((acc, d) => acc + (d.chunk_count || 0), 0);
  }, [vaultDocs]);

  const totalTurns = useMemo(() => {
    return sessions.reduce((acc, s) => acc + (s.turn_count || 1), 0);
  }, [sessions]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#0c0d12] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0c0d12] text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 md:py-12 space-y-10">
        {/* Welcome Banner & Quick Launcher */}
        <div className="space-y-6">
          <div className="space-y-1.5">
            <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
              RESEARCH WORKSPACE
            </span>
            <h1 className="text-3xl sm:text-4xl font-serif font-bold text-zinc-100 tracking-tight">
              {getGreeting()}, <span className="text-zinc-300">{user.username}</span>.
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-xl leading-relaxed">
              Launch an autonomous multi-agent investigation, or resume past research dossiers from your workspace.
            </p>
          </div>

          {/* Quick Launcher Input Bar */}
          <form onSubmit={handleLaunchSearch} className="relative group max-w-3xl">
            <div className="relative flex items-center bg-[#12131a] border border-zinc-800/80 focus-within:border-zinc-600 focus-within:ring-1 focus-within:ring-zinc-600/30 rounded-2xl shadow-xl transition-all">
              <Search className="w-4 h-4 text-zinc-500 ml-4 shrink-0" />
              <input
                type="text"
                value={launcherQuery}
                onChange={(e) => setLauncherQuery(e.target.value)}
                placeholder="Formulate a new research inquiry (e.g. Solid-state battery commercial yield benchmarks by 2026)..."
                className="w-full bg-transparent px-3 py-3.5 text-xs sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none font-sans"
              />
              <button
                type="submit"
                className="mr-2 px-4 py-2 rounded-xl bg-zinc-200 hover:bg-white text-zinc-950 font-medium text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
              >
                <span>Launch Studio</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-5 space-y-1.5">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-[11px] font-mono uppercase tracking-wider">Research Dossiers</span>
              <Layers className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="text-2xl font-serif font-bold text-zinc-100">
              {sessions.length}
            </div>
            <p className="text-[11px] text-zinc-400">
              {totalTurns} total investigation turns
            </p>
          </div>

          <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-5 space-y-1.5">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-[11px] font-mono uppercase tracking-wider">Private Vault</span>
              <FolderArchive className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="text-2xl font-serif font-bold text-zinc-100">
              {vaultDocs.length}
            </div>
            <p className="text-[11px] text-zinc-400">Proprietary documents & notes</p>
          </div>

          <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-5 space-y-1.5">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-[11px] font-mono uppercase tracking-wider">Indexed Passages</span>
              <Database className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="text-2xl font-serif font-bold text-zinc-100">
              {totalPassages > 0 ? totalPassages.toLocaleString() : "Active"}
            </div>
            <p className="text-[11px] text-zinc-400">Vectorized private evidence units</p>
          </div>
        </div>

        {/* Two-Column Section: Recent Sessions + Vault Widget */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Research Sessions (2 cols) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider font-mono text-zinc-400 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-zinc-400" />
                <span>Recent Research Sessions</span>
              </h2>
              <a href="/studio" className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1">
                <span>Open Studio Workbench</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </a>
            </div>

            {dataLoading ? (
              <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-10 text-center text-xs text-zinc-500 font-mono">
                Loading sessions...
              </div>
            ) : sessions.length === 0 ? (
              <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-10 text-center space-y-3">
                <Layers className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-xs text-zinc-400">No research sessions yet.</p>
                <a
                  href="/studio"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-200 hover:bg-white text-zinc-950 rounded-xl text-xs font-medium transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Start First Investigation</span>
                </a>
              </div>
            ) : (
              <div className="space-y-2.5">
                {sessions.slice(0, 5).map((s) => (
                  <div
                    key={s.id}
                    className="bg-[#12131a] hover:bg-[#161822] border border-zinc-800/80 hover:border-zinc-700/80 rounded-xl p-4 transition-all flex items-center justify-between gap-4 group"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-300 border border-zinc-700/60 font-medium">
                          {s.turn_count} {s.turn_count === 1 ? "turn" : "turns"}
                        </span>
                        <span className="text-[11px] text-zinc-500 font-mono">
                          {new Date(s.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-zinc-200 group-hover:text-zinc-100 transition-colors truncate">
                        {s.title}
                      </h3>
                      {s.latest_query && (
                        <p className="text-xs text-zinc-400 truncate">
                          {s.latest_query}
                        </p>
                      )}
                    </div>

                    <a
                      href={`/session/${s.id}`}
                      className="px-3 py-1.5 bg-[#161822] hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-all flex items-center gap-1 shrink-0 border border-zinc-800"
                    >
                      <span>Open</span>
                      <ArrowRight className="w-3 h-3 text-zinc-400" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Knowledge Vault Storage Widget (1 col) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider font-mono text-zinc-400 flex items-center gap-2">
                <FolderArchive className="w-3.5 h-3.5 text-zinc-400" />
                <span>Knowledge Vault</span>
              </h2>
              <a href="/vault" className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
                Manage
              </a>
            </div>

            <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-5 space-y-4">
              <div className="space-y-1 text-xs">
                <p className="text-zinc-200 font-medium">Private Document Memory</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Upload internal PDFs or notes. Ada cross-references them with live web intelligence during autonomous research.
                </p>
              </div>

              {vaultDocs.length > 0 ? (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {vaultDocs.slice(0, 5).map((d) => (
                    <div
                      key={d.doc_name}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#0c0d12] border border-zinc-800/80 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span className="truncate text-zinc-300">{d.doc_name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0 ml-2">
                        {d.size_kb} KB
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-zinc-800 text-center text-xs text-zinc-500">
                  No private documents uploaded yet.
                </div>
              )}

              <a
                href="/vault"
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium transition-all"
              >
                <span>Manage Vault Documents</span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
