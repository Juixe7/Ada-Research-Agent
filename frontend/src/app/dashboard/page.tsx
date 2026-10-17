"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, FolderArchive, Layers, ChevronRight, Database } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { API_URL, formatDossierDate } from "@/lib/config";

interface SessionItem {
  id: string;
  title: string;
  latest_query?: string;
  latest_status?: string;
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
  const [dataError, setDataError] = useState(false);

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
      fetch(`${API_URL}/api/sessions`, { headers }).then(r => {
        if (!r.ok) throw new Error("Could not load research conversations");
        return r.json();
      }),
      fetch(`${API_URL}/api/vault`, { headers }).then(r => {
        if (!r.ok) throw new Error("Could not load the source library");
        return r.json();
      })
    ])
      .then(([sessData, vaultData]) => {
        setSessions(sessData.sessions || []);
        setVaultDocs(vaultData.documents || []);
      })
      .catch((err) => {
        console.warn("Dashboard fetch warning:", err);
        setDataError(true);
      })
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

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const formatResearchStatus = (status?: string) => {
    if (status === "completed") return "Completed";
    if (status === "failed") return "Needs attention";
    if (status === "cancelled") return "Cancelled";
    if (status === "empty") return "No research yet";
    return "In progress";
  };

  const totalPassages = useMemo(() => {
    return vaultDocs.reduce((acc, d) => acc + (d.chunk_count || 0), 0);
  }, [vaultDocs]);

  const totalTurns = useMemo(() => {
    return sessions.reduce((acc, s) => acc + (s.turn_count || 0), 0);
  }, [sessions]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center font-mono text-xs text-[var(--ink-3)]">
        <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-quiet-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 md:py-14 space-y-10">
        {/* Welcome Banner & Quick Launcher */}
        <div className="space-y-4">
          <div className="space-y-1">
            <span className="text-[11px] font-mono text-[var(--ink-3)] uppercase tracking-wider block">
              YOUR WORKSPACE
            </span>
            <h1 className="text-3xl sm:text-4xl font-serif font-bold text-[var(--ink)] tracking-tight">
              {getGreeting()}, <span className="text-[var(--accent)]">{user.username}</span>.
            </h1>
            <p className="text-xs sm:text-sm text-[var(--ink-2)] max-w-xl leading-relaxed">
              Formulate a research inquiry or resume active investigations from your private workspace.
            </p>
          </div>

          {/* Quick Launcher Input Bar */}
          <form onSubmit={handleLaunchSearch} className="space-y-2.5 max-w-2xl">
            <div className="relative flex items-center bg-[var(--surface)] border border-[var(--line-strong)] focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)]/30 rounded-xl shadow-xs transition-all">
              <Search className="w-4 h-4 text-[var(--ink-3)] ml-4 shrink-0" />
              <input
                type="text"
                value={launcherQuery}
                onChange={(e) => setLauncherQuery(e.target.value)}
                placeholder="What are you trying to understand?"
                className="w-full bg-transparent px-3.5 py-3.5 text-xs sm:text-sm text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none font-sans"
              />
              <button
                type="submit"
                className="mr-2.5 btn-primary text-xs py-2 px-4 shadow-xs flex items-center gap-1.5"
              >
                <span>Launch</span>
                <span className="text-[10px] opacity-60 font-mono hidden sm:inline">↵</span>
              </button>
            </div>

            <p className="text-xs text-[var(--ink-3)]">
              Ask a focused question, compare ideas, or check a claim against your sources.
            </p>
          </form>
        </div>

        {/* Workspace overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--line-strong)] rounded-xl p-5 space-y-2 transition-colors shadow-xs">
            <div className="flex items-center justify-between text-[var(--ink-3)]">
              <span className="text-xs font-medium">Research conversations</span>
              <Layers className="w-4 h-4 text-[var(--accent)]" />
            </div>
            <div className="text-3xl font-serif font-bold text-[var(--ink)] tracking-tight">
              {dataLoading || dataError ? "—" : sessions.length}
            </div>
            <p className="text-xs text-[var(--ink-3)] leading-relaxed">
              Pick up a previous line of inquiry.
            </p>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--line-strong)] rounded-xl p-5 space-y-2 transition-colors shadow-xs">
            <div className="flex items-center justify-between text-[var(--ink-3)]">
              <span className="text-xs font-medium">Source library</span>
              <FolderArchive className="w-4 h-4 text-[var(--accent)]" />
            </div>
            <div className="text-3xl font-serif font-bold text-[var(--ink)] tracking-tight">
              {dataLoading || dataError ? "—" : vaultDocs.length}
            </div>
            <p className="text-xs text-[var(--ink-3)] leading-relaxed">
              Documents you can bring into new research.
            </p>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--line-strong)] rounded-xl p-5 space-y-2 transition-colors shadow-xs">
            <div className="flex items-center justify-between text-[var(--ink-3)]">
              <span className="text-xs font-medium">Searchable passages</span>
              <Database className="w-4 h-4 text-[var(--accent)]" />
            </div>
            <div className="text-3xl font-serif font-bold text-[var(--ink)] tracking-tight">
              {dataLoading || dataError ? "—" : totalPassages.toLocaleString()}
            </div>
            <p className="text-xs text-[var(--ink-3)] leading-relaxed">
              Excerpts indexed from your source documents.
            </p>
          </div>
        </div>

        {/* Active Research Sessions Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-[var(--line)]">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
              Recent research
            </span>
            <Link
              href="/history"
              className="text-sm text-[var(--ink-2)] hover:text-[var(--accent)] transition-colors"
            >
              View history →
            </Link>
          </div>

          {dataLoading ? (
            <div className="py-8 text-center text-sm text-[var(--ink-3)]" role="status">
              Loading your research…
            </div>
          ) : dataError ? (
            <div role="alert" className="p-6 text-center bg-[var(--surface)] border border-[var(--line)] rounded-xl text-sm text-[var(--ink-2)]">
              Your workspace data is temporarily unavailable. Refresh to try again.
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center bg-[var(--surface)] border border-[var(--line)] rounded-xl space-y-2 text-sm text-[var(--ink-2)]">
              <p>No research conversations yet. Start with a question you want to investigate.</p>
              <Link href="/studio" className="btn-primary text-sm inline-flex mt-1">
                Start research
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-xl bg-[var(--surface)] overflow-hidden shadow-xs">
              {sessions.map((sess) => (
                <Link
                  key={sess.id}
                  href={`/session/${sess.id}`}
                  className="p-4 hover:bg-[var(--surface-2)] focus-visible:outline-offset-[-2px] transition-colors flex items-center justify-between text-sm group"
                >
                  <div className="space-y-1 min-w-0 pr-4">
                    <span className="font-medium text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors truncate block text-xs sm:text-sm">
                      {sess.title || sess.latest_query}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-[var(--ink-3)]">
                      <span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--line)] text-[var(--accent)]">
                        {sess.turn_count === 1 ? "1 turn" : `${sess.turn_count} turns`}
                      </span>
                      <span>•</span>
                      <span>{formatResearchStatus(sess.latest_status)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-mono text-[var(--ink-3)] shrink-0">
                    <span className="hidden sm:inline">
                      {sess.updated_at ? formatDossierDate(sess.updated_at) : ""}
                    </span>
                    <ChevronRight className="w-4 h-4 text-[var(--ink-4)] group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
