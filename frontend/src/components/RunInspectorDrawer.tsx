"use client";

import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { API_URL } from "@/lib/config";

type EvidenceSource = {
  source_id?: string;
  kind?: string;
  title?: string;
  url?: string;
  domain?: string;
  authority_tier?: number | string;
  snippet?: string;
};
type CriticFinding = { id?: string; type?: string; round?: number; status?: string; description?: string; resolution_note?: string };
type ClaimCheck = { claim_id?: string | number; sentence?: string; tags?: string[]; verdict?: string; reason?: string };
type LlmCall = { id?: string; agent?: string; model?: string; tokens_in?: number; tokens_out?: number; latency_ms?: number; cost?: number; cache_hit?: boolean };
type RunEvent = { id?: string; seq?: number; type?: string; payload?: Record<string, unknown>; created_at?: string };

interface RunInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  runId: string;
  token?: string | null;
  sources?: EvidenceSource[];
  findings?: CriticFinding[];
  scores?: Record<string, number | null>;
}

export default function RunInspectorDrawer({
  isOpen,
  onClose,
  runId,
  token,
  sources = [],
  findings = [],
  scores,
}: RunInspectorProps) {
  const [activeTab, setActiveTab] = useState<"evidence" | "findings" | "claims" | "llm" | "events">("evidence");
  const [llmCalls, setLlmCalls] = useState<LlmCall[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [claims, setClaims] = useState<ClaimCheck[]>([]);
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  const loadingDetails = isOpen && loadedRunId !== runId;
  const [detailsError, setDetailsError] = useState("");
  const [evidenceFilter, setEvidenceFilter] = useState<"all" | "web" | "doc">("all");
  const [selectedEvidenceItem, setSelectedEvidenceItem] = useState<EvidenceSource | null>(null);

  // Load the run's durable inspection data once, so tab switches never look empty
  // just because a separate request was skipped or silently failed.
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetch(`${API_URL}/api/v1/runs/${runId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || `Run inspection could not be loaded (${r.status}).`);
        }
        return r.json();
      })
      .then((data) => {
        setLlmCalls(Array.isArray(data.llm_calls) ? data.llm_calls : []);
        setEvents(Array.isArray(data.events) ? data.events : []);
        setClaims(Array.isArray(data.claims) ? data.claims : []);
        setDetailsError("");
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") setDetailsError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedRunId(runId);
      });
    return () => controller.abort();
  }, [isOpen, runId, token]);

  if (!isOpen) return null;

  const filteredSources = sources.filter((s) => {
    if (evidenceFilter === "web" && s.kind === "doc") return false;
    if (evidenceFilter === "doc" && s.kind !== "doc") return false;
    return true;
  });
  const scoreSummary = ["faithfulness", "coverage", "citation_validity"]
    .filter((key) => typeof scores?.[key] === "number")
    .map((key) => `${key.replace("citation_validity", "citations")} ${((scores?.[key] as number) * 100).toFixed(0)}%`)
    .join(" · ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-2xl h-full bg-[var(--surface)] border-l border-[var(--line)] shadow-2xl flex flex-col text-[var(--ink)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--ink)]">
              Investigation Telemetry & Inspector
            </h2>
            <span className="text-[11px] font-mono text-[var(--ink-3)]">
              #{runId}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--ink-3)] hover:text-[var(--ink)] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 4 Tabs: Evidence, Findings, LLM Calls, Events */}
        <div className="flex items-center px-6 border-b border-[var(--line)] bg-[var(--surface)] text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveTab("evidence")}
            className={`py-3 px-3.5 border-b-2 font-medium transition-colors ${
              activeTab === "evidence"
                ? "border-[var(--accent)] text-[var(--ink)] font-semibold"
                : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink)]"
            }`}
          >
            Evidence ({sources.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("findings")}
            className={`py-3 px-3.5 border-b-2 font-medium transition-colors ${
              activeTab === "findings"
                ? "border-[var(--accent)] text-[var(--ink)] font-semibold"
                : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink)]"
            }`}
          >
            Critic Findings ({findings.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("claims")}
            className={`py-3 px-3.5 border-b-2 font-medium transition-colors ${
              activeTab === "claims"
                ? "border-[var(--accent)] text-[var(--ink)] font-semibold"
                : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink)]"
            }`}
          >
            Claim checks ({claims.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("llm")}
            className={`py-3 px-3.5 border-b-2 font-medium transition-colors ${
              activeTab === "llm"
                ? "border-[var(--accent)] text-[var(--ink)] font-semibold"
                : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink)]"
            }`}
          >
            LLM Calls
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("events")}
            className={`py-3 px-3.5 border-b-2 font-medium transition-colors ${
              activeTab === "events"
                ? "border-[var(--accent)] text-[var(--ink)] font-semibold"
                : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink)]"
            }`}
          >
            Events
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {detailsError && (
            <div role="alert" className="rounded border border-[var(--warn)]/40 bg-[var(--warn-soft)]/20 p-3 text-xs text-[var(--ink)]">
              {detailsError}
            </div>
          )}
          {/* ── Tab 1: Evidence Table ──────────────────────────────── */}
          {activeTab === "evidence" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2">
                <span className="text-[11px] font-mono text-[var(--ink-3)]">
                  Primary sources & citations ledger
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEvidenceFilter("all")}
                    className={`chip text-[10px] py-0.5 px-2 ${evidenceFilter === "all" ? "chip-active" : ""}`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setEvidenceFilter("web")}
                    className={`chip text-[10px] py-0.5 px-2 ${evidenceFilter === "web" ? "chip-active" : ""}`}
                  >
                    Web
                  </button>
                  <button
                    type="button"
                    onClick={() => setEvidenceFilter("doc")}
                    className={`chip text-[10px] py-0.5 px-2 ${evidenceFilter === "doc" ? "chip-active" : ""}`}
                  >
                    Vault
                  </button>
                </div>
              </div>

              <div className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-[6px] overflow-hidden bg-[var(--surface-2)]/30">
                {filteredSources.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[var(--ink-3)] font-mono">
                    No evidence sources match this filter.
                  </div>
                ) : (
                  filteredSources.map((src, i) => (
                    <div
                      key={src.source_id || i}
                      onClick={() => setSelectedEvidenceItem(src)}
                      className="p-3 hover:bg-[var(--surface-2)] transition-colors cursor-pointer flex items-baseline justify-between gap-3 text-xs"
                    >
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-mono text-[11px] font-bold text-[var(--accent)] shrink-0">
                          [{src.source_id || `S${i + 1}`}]
                        </span>
                        <div className="truncate">
                          <span className="font-medium text-[var(--ink)]">
                            {src.title || src.domain}
                          </span>
                          <span className="text-[11px] font-mono text-[var(--ink-3)] ml-2">
                            {src.domain}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] text-[var(--ink-3)]">
                        <span className="uppercase">{src.kind === "doc" ? "VAULT" : "WEB"}</span>
                        <span>{src.authority_tier ? `Tier ${src.authority_tier}` : "Indexed"}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Selected Evidence Item Detail Drawer */}
              {selectedEvidenceItem && (
                <div className="p-4 bg-[var(--surface-2)] border border-[var(--line)] rounded-[6px] space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-[var(--accent)]">
                      Evidence Detail [{selectedEvidenceItem.source_id}]
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedEvidenceItem(null)}
                      className="text-[var(--ink-3)] hover:text-[var(--ink)]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="font-medium text-[var(--ink)]">
                    {selectedEvidenceItem.title}
                  </p>

                  <div className="font-mono text-[11px] text-[var(--ink-3)] space-y-0.5">
                    <div>URL: {selectedEvidenceItem.url || "Internal document"}</div>
                    <div>Domain: {selectedEvidenceItem.domain}</div>
                    <div>Authority Tier: {selectedEvidenceItem.authority_tier ? `Tier ${selectedEvidenceItem.authority_tier}` : "Indexed Primary"}</div>
                  </div>

                  {selectedEvidenceItem.snippet && (
                    <div className="pt-2 border-t border-[var(--line)]">
                      <span className="text-[10px] font-mono uppercase text-[var(--ink-3)] block mb-1">
                        Verbatim Passage
                      </span>
                      <p className="font-serif text-xs text-[var(--ink)] bg-[var(--surface)] p-2.5 rounded border border-[var(--line)] italic leading-relaxed">
                        &ldquo;{selectedEvidenceItem.snippet}&rdquo;
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Claim-level verification ───────────────────────────── */}
          {activeTab === "claims" && (
            <div className="space-y-3">
              <p className="text-[11px] text-[var(--ink-3)]">Sentence-level checks recorded for report claims and their cited evidence.</p>
              {loadingDetails ? (
                <div className="py-6 text-center text-xs text-[var(--ink-3)]">Loading claim checks…</div>
              ) : claims.length === 0 ? (
                <div className="rounded border border-[var(--line)] bg-[var(--surface-2)]/30 py-8 text-center text-xs text-[var(--ink-3)]">
                  No claim verdicts were recorded for this run.
                </div>
              ) : claims.map((claim, i) => {
                const verdict = String(claim.verdict || "unverified").toLowerCase();
                const verdictTone = verdict === "supported" ? "text-[var(--ok)]" : verdict === "unsupported" ? "text-[var(--warn)]" : "text-[var(--ink-2)]";
                return (
                  <article key={`${claim.claim_id || i}-${i}`} className="rounded border border-[var(--line)] bg-[var(--surface-2)]/30 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-[10px] font-mono font-semibold uppercase ${verdictTone}`}>{verdict}</span>
                      <span className="text-[10px] font-mono text-[var(--ink-3)]">{Array.isArray(claim.tags) ? claim.tags.join(", ") : "No source tags"}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-[var(--ink)]">{claim.sentence}</p>
                    {claim.reason && <p className="border-t border-[var(--line)] pt-2 text-[11px] text-[var(--ink-2)]">{claim.reason}</p>}
                  </article>
                );
              })}
            </div>
          )}

          {/* ── Tab 2: Critic Findings ─────────────────────────────── */}
          {activeTab === "findings" && (
            <div className="space-y-3">
              <span className="text-[11px] font-mono text-[var(--ink-3)] block pb-1">
                Adversarial conflicts, numerical contradictions & resolutions
              </span>

              {findings.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--ink-3)] font-mono">
                  No critic findings were recorded for this run.
                </div>
              ) : (
                findings.map((f, i) => (
                  <div
                    key={f.id || i}
                    className="p-3.5 rounded-[6px] border border-[var(--line)] bg-[var(--warn-soft)]/20 border-l-2 border-l-[var(--warn)] space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase font-semibold text-[var(--warn)]">
                        {f.type || "Discrepancy"}{f.round ? ` · Round ${f.round}` : ""}
                      </span>
                      <span className="chip text-[10px] py-0 px-1.5 bg-[var(--surface)]">
                        {f.status || "Resolved"}
                      </span>
                    </div>

                    <p className="text-[var(--ink)] font-medium">
                      {f.description}
                    </p>

                    {f.resolution_note && (
                      <p className="text-[11.5px] text-[var(--ink-2)] italic pt-1 border-t border-[var(--line)]">
                        Resolution: {f.resolution_note}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Tab 3: LLM Calls Ledger ────────────────────────────── */}
          {activeTab === "llm" && (
            <div className="space-y-3">
              <span className="text-[11px] font-mono text-[var(--ink-3)] block pb-1">
                Telemetry, latency, tokens consumed and cache hits
              </span>

              {loadingDetails ? (
                <div className="py-6 text-center text-xs text-[var(--ink-3)] font-mono">
                  Loading LLM call ledger...
                </div>
              ) : llmCalls.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--ink-3)] font-mono border border-[var(--line)] rounded-[6px] bg-[var(--surface-2)]/30">
                  No individual LLM call ledger records tracked for this run.
                </div>
              ) : (
                <>
                <div className="flex flex-wrap gap-x-5 gap-y-1 rounded border border-[var(--line)] bg-[var(--surface-2)]/30 p-3 text-[11px] font-mono text-[var(--ink-2)]">
                  <span>{llmCalls.length} calls</span>
                  <span>{llmCalls.reduce((sum, call) => sum + Number(call.tokens_in || 0), 0).toLocaleString()} input tokens</span>
                  <span>{llmCalls.reduce((sum, call) => sum + Number(call.tokens_out || 0), 0).toLocaleString()} output tokens</span>
                  <span>${llmCalls.reduce((sum, call) => sum + Number(call.cost || 0), 0).toFixed(4)} recorded cost</span>
                </div>
                <div className="border border-[var(--line)] rounded-[6px] overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[var(--surface-2)] text-[10px] uppercase text-[var(--ink-3)] border-b border-[var(--line)]">
                      <tr>
                        <th className="py-2 px-3">Agent</th>
                        <th className="py-2 px-3">Model</th>
                        <th className="py-2 px-3 text-right">In / Out</th>
                        <th className="py-2 px-3 text-right">Latency</th>
                        <th className="py-2 px-3 text-right">Cost</th>
                        <th className="py-2 px-3 text-right">Cache</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)] bg-[var(--surface)]">
                      {llmCalls.map((c, i) => (
                        <tr key={c.id || i} className="hover:bg-[var(--surface-2)]/60">
                          <td className="py-2 px-3 font-semibold text-[var(--ink)]">{c.agent}</td>
                          <td className="py-2 px-3 text-[var(--ink-2)] truncate max-w-[140px]">{c.model}</td>
                          <td className="py-2 px-3 text-right text-[var(--ink-3)]">
                            {c.tokens_in} / {c.tokens_out}
                          </td>
                          <td className="py-2 px-3 text-right text-[var(--ink-2)]">{c.latency_ms}ms</td>
                          <td className="py-2 px-3 text-right text-[var(--ink-2)]">${Number(c.cost || 0).toFixed(4)}</td>
                          <td className="py-2 px-3 text-right">
                            {c.cache_hit ? (
                              <span className="text-[var(--ok)] font-bold">HIT</span>
                            ) : (
                              <span className="text-[var(--ink-3)]">MISS</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </div>
          )}

          {/* ── Tab 4: Durable Events Log ──────────────────────────── */}
          {activeTab === "events" && (
            <div className="space-y-3 font-mono text-xs">
              <span className="text-[11px] text-[var(--ink-3)] block pb-1">
                Monotonic Postgres event journal (Replay sequence)
              </span>

              {loadingDetails ? (
                <div className="py-6 text-center text-[var(--ink-3)]">Loading events...</div>
              ) : events.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--ink-3)] font-mono border border-[var(--line)] rounded-[6px] bg-[var(--surface-2)]/30">
                  No discrete event sequence entries recorded.
                </div>
              ) : (
                <div className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-[6px] bg-[var(--surface-2)]/30">
                  {events.map((evt, i) => {
                    const details = Object.entries(evt.payload || {})
                      .filter(([key, value]) => ["agent", "model", "status", "stage", "source_id", "track_id", "count", "latency_ms", "tokens_in", "tokens_out", "message", "error"].includes(key) && ["string", "number", "boolean"].includes(typeof value))
                      .slice(0, 4);
                    return (
                      <div key={evt.id || i} className="p-2.5 flex items-start justify-between gap-3 text-[11px]">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[var(--ink-3)]">#{evt.seq || i + 1}</span>
                            <span className="font-semibold text-[var(--accent)]">{evt.type || "event"}</span>
                          </div>
                          {details.length > 0 && (
                            <p className="break-words text-[10px] text-[var(--ink-3)]">
                              {details.map(([key, value]) => `${key}: ${String(value).slice(0, 140)}`).join(" · ")}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-[var(--ink-3)]">{evt.created_at || ""}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between text-xs font-mono text-[var(--ink-3)]">
          <span>{scoreSummary || (loadingDetails ? "Loading run scores…" : "Run inspection loaded")}</span>
          <button
            type="button"
            onClick={onClose}
            className="btn-primary text-xs"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
