"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, Search, GitCompare } from "lucide-react";
import Navbar from "@/components/Navbar";
import { API_URL, formatDossierDate } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";
import type { ResearchReportSummary } from "@/lib/api-types";

export default function HistoryArchivePage() {
  const router = useRouter();
  const { token } = useAuth();
  const [reports, setReports] = useState<ResearchReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [depthFilter, setDepthFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/reports`, { headers })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load research history");
        return res.json();
      })
      .then((data: { reports?: ResearchReportSummary[] }) => {
        if (data.reports) setReports(data.reports);
      })
      .catch((err) => {
        console.error("Failed to load reports:", err);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id));
    } else {
      if (selectedIds.length < 2) {
        setSelectedIds([...selectedIds, id]);
      } else {
        setSelectedIds([selectedIds[1], id]);
      }
    }
  };

  const filtered = useMemo(() => {
    return reports.filter((r) => {
      const q = (r.query || r.title || "").toLowerCase();
      const matchSearch = q.includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      const matchDepth = depthFilter === "all" || r.depth === depthFilter;
      return matchSearch && matchStatus && matchDepth;
    });
  }, [reports, searchTerm, statusFilter, depthFilter]);

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)]">
              <Clock className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Your research</span>
            </div>
            <h1 className="text-2xl font-serif font-bold text-[var(--ink)] tracking-tight">
              Research history
            </h1>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[var(--ink-3)]" />
            <input
              type="text"
              aria-label="Search your research"
              placeholder="Search your research…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-base w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--surface)]"
            />
          </div>
        </div>

        {/* Filter Chips & Compare Action */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Status filters */}
            <div className="inline-flex items-center border border-[var(--line)] rounded-[4px] bg-[var(--surface)] p-0.5 text-xs font-mono">
              {["all", "completed", "running", "failed"].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  aria-pressed={statusFilter === st}
                  className={`px-2 py-0.5 rounded-[3px] capitalize transition-colors ${
                    statusFilter === st ? "bg-[var(--surface-2)] text-[var(--ink)] font-bold" : "text-[var(--ink-3)]"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Depth filters */}
            <div className="inline-flex items-center border border-[var(--line)] rounded-[4px] bg-[var(--surface)] p-0.5 text-xs font-mono">
              {["all", "quick", "standard", "deep"].map((dp) => (
                <button
                  key={dp}
                  type="button"
                  onClick={() => setDepthFilter(dp)}
                  aria-pressed={depthFilter === dp}
                  className={`px-2 py-0.5 rounded-[3px] capitalize transition-colors ${
                    depthFilter === dp ? "bg-[var(--surface-2)] text-[var(--ink)] font-bold" : "text-[var(--ink-3)]"
                  }`}
                >
                  {dp}
                </button>
              ))}
            </div>
          </div>

          {/* Screen 7.7 Compare Action: Appears when 2 rows selected */}
          {selectedIds.length === 2 && (
            <button
              type="button"
              onClick={() => router.push(`/report/${selectedIds[0]}`)}
              className="btn-primary text-xs py-1 px-3 flex items-center gap-1.5 animate-in fade-in duration-150"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Compare 2 Selected Runs</span>
            </button>
          )}
        </div>

        {/* Screen 7.7 Dense Table (36px row height, calm hairline borders) */}
        <div className="border border-[var(--line)] rounded-[6px] overflow-hidden bg-[var(--surface)]">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-[var(--surface-2)] text-[10.5px] font-mono uppercase tracking-wider text-[var(--ink-3)] border-b border-[var(--line)]">
              <tr>
                <th className="py-2.5 px-3 w-8"></th>
                <th className="py-2.5 px-3">Question</th>
                <th className="py-2.5 px-3 w-24">Depth</th>
                <th className="py-2.5 px-3 w-28">Status</th>
                <th className="py-2.5 px-3 w-36 text-right whitespace-nowrap">Citation quality</th>
                <th className="py-2.5 px-3 w-24 text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs font-mono text-[var(--ink-3)]">
                    Loading research history…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={6} role="alert" className="py-12 text-center text-xs text-[var(--ink-3)]">
                    Research history is unavailable right now. Refresh this page to try again.
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs font-mono text-[var(--ink-3)]">
                      No research found for these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const id = item.report_id;
                  const isSelected = selectedIds.includes(id);
                  const isCompleted = item.status === "completed";
                  const isFailed = item.status === "failed";
                  const score = item.faithfulness_score !== undefined && item.faithfulness_score !== null ? item.faithfulness_score : null;

                  return (
                    <tr
                      key={id}
                      className={`h-[44px] hover:bg-[var(--surface-2)] transition-colors group ${
                        isSelected ? "bg-[var(--accent-soft)]/60" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isCompleted}
                          aria-label={`Select ${item.query || item.title || "research"} for comparison`}
                          title={!isCompleted ? "Only completed research can be compared" : "Select for comparison"}
                          onChange={() => toggleSelect(id)}
                          className="rounded-[3px] accent-[var(--accent)] cursor-pointer"
                        />
                      </td>

                      {/* Question */}
                      <td className="py-2 px-3 font-medium truncate max-w-md">
                        <Link
                          href={isCompleted ? `/report/${id}` : `/run/${id}`}
                          className="text-[var(--ink)] group-hover:text-[var(--accent)] focus-visible:underline transition-colors"
                        >
                          {item.title || item.query || `Research #${id}`}
                        </Link>
                      </td>

                      {/* Depth */}
                      <td className="py-2 px-3 font-mono text-[11px] text-[var(--ink-3)] capitalize">
                        {item.depth || "standard"}
                      </td>

                      {/* Status */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-mono">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isCompleted
                                ? "bg-[var(--ok)]"
                                : isFailed
                                ? "bg-[var(--bad)]"
                                : "bg-[var(--accent)] animate-quiet-pulse"
                            }`}
                          />
                          <span className="capitalize text-[var(--ink-2)]">{item.status}</span>
                        </div>
                      </td>

                      {/* Faithfulness */}
                      <td className="py-2 px-3 text-right font-mono text-[11px] text-[var(--ok)] font-medium">
                        {score !== null ? `${(score * 100).toFixed(0)}%` : isCompleted ? "Not scored" : isFailed ? "—" : "Pending"}
                      </td>

                      {/* Created Date */}
                      <td className="py-2 px-3 text-right font-mono text-[11px] text-[var(--ink-3)]">
                        {formatDossierDate(item.created_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
