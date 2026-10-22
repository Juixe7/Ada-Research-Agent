import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { headingSlug, headingText } from "@/lib/report-content";

export type ReportTextSize = "S" | "M" | "L";

interface ReportMonographProps {
  markdown: string;
  textSize: ReportTextSize;
  onCitationClick: (citationTag: string) => void;
}

const textSizeClasses: Record<ReportTextSize, string> = {
  S: "text-[15px] leading-[1.65]",
  M: "text-[18px] leading-[1.68]",
  L: "text-[20px] leading-[1.72]",
};

/** Render report markdown with stable section IDs and clickable evidence citations. */
export default function ReportMonograph({
  markdown,
  textSize,
  onCitationClick,
}: ReportMonographProps) {
  return (
    <div className={`font-serif ${textSizeClasses[textSize]} text-[var(--ink)] leading-[1.68] space-y-6 monograph-prose`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => {
            const titleText = headingText(children);
            return (
              <h2
                id={headingSlug(titleText)}
                className="relative font-serif text-[24px] font-semibold text-[var(--ink)] pt-10 pb-2 mt-8 border-t border-[var(--line)] scroll-mt-16 leading-snug"
              >
                {children}
              </h2>
            );
          },
          h3: ({ children }) => (
            <h3 className="font-serif text-[19px] font-semibold text-[var(--ink)] pt-6 pb-1 leading-snug">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="my-4 leading-[1.68]">
              {React.Children.map(children, (child) => {
                if (typeof child !== "string") return child;

                const parts = child.split(/(\[(?:S|D)?\d+\])/g);
                return parts.map((part, index) => {
                  const match = part.match(/^\[((?:S|D)?\d+)\]$/);
                  if (!match) return part;

                  const tag = match[1];
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => onCitationClick(tag)}
                      className="citation-badge"
                      title={`View citation [${tag}]`}
                    >
                      [{tag}]
                    </button>
                  );
                });
              })}
            </p>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--accent)] pl-4 py-1 my-6 font-serif italic text-[var(--ink-2)] bg-transparent">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-8 overflow-x-auto border border-[var(--line)] rounded-[6px] bg-[var(--surface)]">
              <table className="w-full text-left font-sans text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[var(--surface-2)] font-mono text-[11px] uppercase text-[var(--ink-3)] border-b border-[var(--line)]">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="py-2.5 px-3.5 font-semibold text-[var(--ink-2)]">{children}</th>
          ),
          td: ({ children }) => (
            <td className="py-2.5 px-3.5 border-t border-[var(--line)] font-mono text-[12px] text-[var(--ink)]">
              {children}
            </td>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
