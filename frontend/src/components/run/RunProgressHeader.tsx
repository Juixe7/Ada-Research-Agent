import { ArrowLeft, ArrowUpRight } from "lucide-react";
import type { RunStatus } from "@/lib/research-run-types";

const PIPELINE_STAGES = [
  { id: "scope", label: "Scope" },
  { id: "plan", label: "Plan" },
  { id: "gather", label: "Gather" },
  { id: "audit", label: "Audit" },
  { id: "write", label: "Write" },
  { id: "verify", label: "Verify" },
];

interface RunProgressHeaderProps {
  query: string;
  depth: string;
  elapsedSeconds: number;
  status: RunStatus;
  reconnected: boolean;
  activeStage: string;
  stageProgressNote: string;
  selectedStageFilter: string;
  onBack: () => void;
  onViewReport: () => void;
  onStageFilterChange: (stageId: string) => void;
}

/** Show a run's phase, elapsed time, and filters for its stage activity. */
export default function RunProgressHeader({
  query,
  depth,
  elapsedSeconds,
  status,
  reconnected,
  activeStage,
  stageProgressNote,
  selectedStageFilter,
  onBack,
  onViewReport,
  onStageFilterChange,
}: RunProgressHeaderProps) {
  const currentStageIndex = PIPELINE_STAGES.findIndex(({ id }) => id === activeStage);

  return (
    <header className="sticky top-0 z-30 bg-[var(--surface)] hairline-b">
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="p-1 rounded text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors"
              title="Return to dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="font-serif text-[17px] font-semibold text-[var(--ink)] truncate max-w-xl">
              {query}
            </h1>
            {reconnected && (
              <span className="text-[10px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 rounded-[3px]">
                Reconnected
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0 font-mono text-xs text-[var(--ink-2)]">
            <span className="capitalize px-2 py-0.5 rounded-[4px] bg-[var(--surface-2)] border border-[var(--line)]">
              {depth}
            </span>
            <span>·</span>
            <span className="text-[var(--ink)] font-semibold">{formatTimer(elapsedSeconds)}</span>
            {status === "completed" && (
              <button
                type="button"
                onClick={onViewReport}
                className="btn-primary py-1 px-3 text-xs ml-2"
              >
                <span>View report</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto py-1">
            {PIPELINE_STAGES.map((stage, index) => {
              const isDone = index < currentStageIndex || status === "completed";
              const isActive = index === currentStageIndex && status === "running";

              return (
                <button
                  key={stage.id}
                  type="button"
                  aria-pressed={selectedStageFilter === stage.id}
                  onClick={() => onStageFilterChange(stage.id)}
                  className={`flex items-center gap-1.5 text-xs font-sans transition-all ${
                    selectedStageFilter === stage.id
                      ? "text-[var(--accent)] font-semibold"
                      : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                  }`}
                >
                  <div
                    className={`w-2.5 h-2.5 rounded-full transition-all shrink-0 ${
                      isDone
                        ? "bg-[var(--ink-2)]"
                        : isActive
                          ? "bg-transparent border-2 border-[var(--accent)] animate-quiet-pulse"
                          : "border border-[var(--line-strong)]"
                    }`}
                  />
                  <span className="uppercase text-[11px] tracking-wider font-mono">
                    {stage.label}
                  </span>
                  {index < PIPELINE_STAGES.length - 1 && (
                    <span className="text-[var(--line-strong)] select-none ml-2 sm:ml-3">—</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="text-[11px] font-mono text-[var(--ink-3)] hidden md:block">
            {stageProgressNote}
          </div>
        </div>
      </div>
    </header>
  );
}

function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}
