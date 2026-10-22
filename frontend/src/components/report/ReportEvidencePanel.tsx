import { ChevronRight } from "lucide-react";
import type { ReportScores } from "@/lib/report-types";

interface ReportEvidencePanelProps {
  scores: ReportScores | null;
  citationValidity: number | null;
  unmatchedCitationCount: number | null | undefined;
  onOpenDetails: () => void;
}

export default function ReportEvidencePanel({
  scores,
  citationValidity,
  unmatchedCitationCount,
  onOpenDetails,
}: ReportEvidencePanelProps) {
  return (
    <aside className="hidden xl:block w-[280px] shrink-0 sticky top-20 space-y-6 font-sans">
      <div className="p-4 rounded-[10px] bg-[var(--surface)] border border-[var(--line)] space-y-4">
        <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold block">
          Evidence Signals
        </span>

        {scores ? (
          <>
            <div className="space-y-3 font-mono text-xs">
              <ScoreBar label="Claims supported" value={scores.faithfulness} tone="positive" />
              <ScoreBar
                label="Track relevance"
                value={scores.relevancy}
                title="Mean evidence relevance judged across planned research tracks."
              />
              <ScoreBar
                label="Heuristic authority"
                value={scores.authority}
                tone="muted"
                title="Heuristic source-domain estimate; it is not a verification of source accuracy."
              />
              <ScoreBar
                label="Track coverage"
                value={scores.coverage}
                title="Tracks with judged relevance of at least 0.65 and evidence from at least two distinct source domains or documents."
              />
            </div>

            <div className="flex justify-between text-[11px] font-mono pt-2 border-t border-[var(--line)]">
              <span className="text-[var(--ink-2)]">Citation IDs resolved</span>
              <span className="font-semibold text-[var(--ink)]">
                {formatPercent(citationValidity) ?? "Not measured"}
              </span>
            </div>

            <p className="text-xs font-sans text-[var(--ink-2)] pt-1 border-t border-[var(--line)] leading-relaxed">
              Claim support is judged against cited excerpts. Unavailable judgments are shown as unmeasured; citation-ID validity is reported separately.
            </p>
            <p className="text-[11px] font-sans text-[var(--ink-3)] leading-relaxed">
              Track coverage requires relevant evidence from two independent sources. Authority is a domain heuristic, not a factuality check.
            </p>
          </>
        ) : (
          <p className="text-xs font-sans text-[var(--ink-3)] leading-relaxed">
            Verification telemetry was not recorded for this legacy dossier.
          </p>
        )}

        <button type="button" onClick={onOpenDetails} className="btn-secondary w-full text-xs">
          <span>Open details</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3.5 rounded-[8px] bg-[var(--surface-2)]/30 border border-[var(--line)] space-y-2 text-xs">
        <span className="text-[10px] font-mono uppercase text-[var(--ink-3)] font-semibold block">
          Unmatched Citation IDs
        </span>
        <p className="text-[11px] text-[var(--ink-3)] leading-relaxed">
          {unmatchedCitationCount ?? "—"} citation IDs did not match the retrieved evidence manifest. Claim judgments and reasons are listed in run details.
        </p>
      </div>
    </aside>
  );
}

interface ScoreBarProps {
  label: string;
  value: number | null | undefined;
  tone?: "positive" | "muted";
  title?: string;
}

function ScoreBar({ label, value, tone, title }: ScoreBarProps) {
  const color = tone === "positive" ? "var(--ok)" : tone === "muted" ? "var(--ink-2)" : "var(--accent)";
  const percent = value == null ? null : value * 100;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-[var(--ink-2)]" title={title}>{label}</span>
        <span className={`font-semibold ${tone === "positive" ? "text-[var(--ok)]" : "text-[var(--ink)]"}`}>
          {formatPercent(value) ?? "—"}
        </span>
      </div>
      <div className="w-full h-1 bg-[var(--line)] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${percent ?? 0}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function formatPercent(value: number | null | undefined): string | null {
  return value == null ? null : `${(value * 100).toFixed(0)}%`;
}
