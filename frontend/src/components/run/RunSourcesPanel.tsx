"use client";

import { useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import type { RunSource, RunStatus } from "@/lib/research-run-types";

type SourceFilter = "all" | "web" | "vault";

interface RunSourcesPanelProps {
  sources: RunSource[];
  status: RunStatus;
}

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "web", label: "Web" },
  { id: "vault", label: "Vault" },
];

function emptyMessage(status: RunStatus): string {
  if (status === "running") return "No sources ingested yet. Crawlers gathering…";
  if (status === "completed") return "No source records were saved for this investigation.";
  return "No sources were captured before this run ended.";
}

/** Displays run evidence and the selected source's provenance details. */
export default function RunSourcesPanel({ sources, status }: RunSourcesPanelProps) {
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [selectedSource, setSelectedSource] = useState<RunSource | null>(null);

  const visibleSources = useMemo(
    () => sources.filter((source) => (
      filter === "all" || (filter === "vault" ? source.isVault : !source.isVault)
    )),
    [filter, sources],
  );

  return (
    <>
      <aside className="w-full md:w-[380px] shrink-0 bg-[var(--surface)] hairline-l flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
            Evidence Sources ({visibleSources.length})
          </span>
          <div role="group" aria-label="Filter evidence sources" className="flex items-center gap-1">
            {SOURCE_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={"chip text-[10px] py-0.5 px-2 " + (filter === option.id ? "chip-active" : "")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {visibleSources.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--ink-3)] font-mono" role="status">
              {sources.length ? "No sources match this filter." : emptyMessage(status)}
            </div>
          ) : (
            visibleSources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => setSelectedSource(source)}
                aria-label={"Inspect source: " + source.title}
                className={"w-full p-3 rounded-[6px] border border-[var(--line)] bg-[var(--surface-2)]/50 hover:bg-[var(--surface-2)] transition-colors text-left space-y-2 " + (
                  source.isNew ? "animate-feed-highlight" : ""
                )}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-xs font-sans font-medium text-[var(--ink)] line-clamp-2 leading-snug">
                    {source.title}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--ink-3)] shrink-0">
                    {source.date}
                  </span>
                </span>

                <span className="flex items-center justify-between text-[11px] font-mono text-[var(--ink-3)]">
                  <span className="text-[var(--accent)] truncate max-w-[180px]">{source.domain}</span>
                  {source.authorityDots != null ? (
                    <span
                      className="flex items-center gap-1"
                      title={"Heuristic authority estimate: " + source.authorityDots + "/5"}
                      aria-label={"Heuristic authority estimate: " + source.authorityDots + " out of 5"}
                    >
                      {[1, 2, 3, 4, 5].map((dot) => (
                        <span
                          key={dot}
                          aria-hidden="true"
                          className={"w-1 h-1 rounded-full " + (dot <= source.authorityDots! ? "bg-[var(--ink-2)]" : "bg-[var(--line-strong)]")}
                        />
                      ))}
                    </span>
                  ) : <span className="text-[10px]">Unscored</span>}
                </span>

                {source.excerpt && (
                  <span className="block font-serif text-[11.5px] text-[var(--ink-2)] line-clamp-2 italic leading-relaxed pt-1 border-t border-[var(--line)]">
                    &ldquo;{source.excerpt}&rdquo;
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {selectedSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="run-source-title"
            className="w-full max-w-md h-full bg-[var(--surface)] border-l border-[var(--line)] p-6 flex flex-col justify-between shadow-2xl"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                <span className="text-[11px] font-mono uppercase text-[var(--ink-3)]">Evidence Inspector</span>
                <button
                  type="button"
                  aria-label="Close evidence inspector"
                  onClick={() => setSelectedSource(null)}
                  className="p-1 text-[var(--ink-3)] hover:text-[var(--ink)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <h2 id="run-source-title" className="font-serif text-[18px] text-[var(--ink)] leading-snug">
                {selectedSource.title}
              </h2>

              <div className="text-xs font-mono text-[var(--ink-2)] space-y-1">
                <div>Domain: {selectedSource.domain}</div>
                <div>Published: {selectedSource.date || "Unknown"}</div>
                <div>Heuristic authority estimate: {selectedSource.authorityDots != null ? selectedSource.authorityDots + "/5" : "Not measured"}</div>
              </div>

              {selectedSource.excerpt && (
                <div className="pt-3 border-t border-[var(--line)]">
                  <span className="text-[11px] font-mono uppercase text-[var(--ink-3)] block mb-2">
                    Verbatim Passage Excerpt
                  </span>
                  <p className="font-serif text-xs text-[var(--ink)] leading-relaxed bg-[var(--surface-2)] p-3 rounded-[6px] border border-[var(--line)] italic">
                    &ldquo;{selectedSource.excerpt}&rdquo;
                  </p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[var(--line)] flex items-center justify-between">
              {selectedSource.url && (
                <a
                  href={selectedSource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <span>Open original URL</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              )}
              <button type="button" onClick={() => setSelectedSource(null)} className="btn-primary text-xs">
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
