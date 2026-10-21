import type { RefObject, UIEvent } from "react";

import type { ActivityEvent } from "@/lib/research-run-types";

interface RunActivityFeedProps {
  events: ActivityEvent[];
  selectedStage: string | "all";
  userScrolledUp: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollStateChange: (userScrolledUp: boolean) => void;
  onJumpToLatest: () => void;
}

/** Renders the run's chronological telemetry and manages feed scrolling controls. */
export default function RunActivityFeed({
  events,
  selectedStage,
  userScrolledUp,
  scrollRef,
  onScrollStateChange,
  onJumpToLatest,
}: RunActivityFeedProps) {
  const visibleEvents = events.filter(
    (event) => selectedStage === "all" || event.stage === selectedStage,
  );

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 50;
    onScrollStateChange(!isAtBottom);
  };

  return (
    <main className="flex-1 flex flex-col bg-[var(--paper)] relative overflow-hidden min-h-[400px]">
      <div className="px-5 py-3 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface)]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
            Activity Stream
          </span>
          {selectedStage !== "all" && (
            <span className="text-[10px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 rounded-[3px]">
              stage: {selectedStage}
            </span>
          )}
        </div>

        {userScrolledUp && (
          <button
            type="button"
            onClick={onJumpToLatest}
            className="chip text-[11px] text-[var(--accent)] border-[var(--accent)]"
          >
            Jump to latest ↓
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-5 space-y-3 font-sans text-xs"
      >
        {visibleEvents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--ink-3)] py-12 space-y-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-quiet-pulse" />
            <p className="font-mono text-xs">
              {events.length ? "No activity in this stage yet." : "Waiting for agent activity telemetry..."}
            </p>
          </div>
        ) : (
          visibleEvents.map((event) => {
            const isHighlighted = event.type === "critic" || event.type === "warning";
            return (
              <article
                key={event.id}
                className={"flex items-start gap-3 py-1.5 " + (isHighlighted
                  ? "border-l-2 border-[var(--warn)] pl-3 bg-[var(--warn-soft)]/30 rounded-r-[4px] py-2"
                  : "")}
              >
                <span className="font-mono text-[11px] text-[var(--ink-3)] shrink-0 pt-0.5">
                  {event.timestamp}
                </span>

                <div className="flex-1 text-[var(--ink)] leading-relaxed">
                  <span className="text-[var(--ink-2)]">{event.text}</span>
                  {event.rawQuery && (
                    <code className="font-mono text-[11.5px] text-[var(--ink)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded-[3px] ml-1">
                      &ldquo;{event.rawQuery}&rdquo;
                    </code>
                  )}
                  {event.domain && (
                    <a
                      href={"https://" + event.domain}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[11.5px] text-[var(--accent)] hover:underline ml-1"
                    >
                      {event.domain}
                    </a>
                  )}

                  {event.criticFinding && (
                    <div className="mt-2 p-2 bg-[var(--surface)] border border-[var(--line)] rounded-[4px] space-y-1 text-xs">
                      <span className="text-[10px] font-mono uppercase text-[var(--warn)] font-semibold block">
                        Adversarial Conflict Detected
                      </span>
                      {event.criticFinding.claim && (
                        <p className="text-[var(--ink)] font-medium">{event.criticFinding.claim}</p>
                      )}
                      {event.criticFinding.conflictingValues && (
                        <ul className="font-mono text-[11px] text-[var(--ink-2)] pt-1 space-y-0.5">
                          {event.criticFinding.conflictingValues.map((value, index) => (
                            <li key={index}>{value}</li>
                          ))}
                        </ul>
                      )}
                      {event.criticFinding.resolution && (
                        <p className="text-[11px] text-[var(--ink-3)] italic pt-1 border-t border-[var(--line)] mt-1">
                          Resolution: {event.criticFinding.resolution}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </main>
  );
}
