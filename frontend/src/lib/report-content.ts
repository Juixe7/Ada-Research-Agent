import React from "react";
import type { ReactNode } from "react";

import type {
  CitationDetails,
  ReportChapter,
  ReportData,
  ReportSource,
} from "@/lib/report-types";

/** Converts rendered markdown heading children into plain text for stable IDs. */
export function headingText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(headingText).join("");
  if (React.isValidElement<{ children?: ReactNode }>(node)) {
    return headingText(node.props.children);
  }
  return "";
}

/** Creates URL-safe, deterministic anchor IDs from report section titles. */
export function headingSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

function sourceDomain(url?: string | null): string {
  if (!url) return "vault";
  try {
    return new URL(url).hostname;
  } catch {
    return "external source";
  }
}

/** Combines evidence-manifest and legacy source records into a citation lookup. */
export function buildCitationMap(report: ReportData | null): Map<string, CitationDetails> {
  const citations = new Map<string, CitationDetails>();
  if (!report) return citations;

  for (const evidence of report.evidence_manifest ?? []) {
    const id = evidence.source_id || evidence.id;
    if (!id) continue;
    citations.set(id, {
      id,
      title: evidence.title || evidence.doc_name || "Primary source",
      url: evidence.url,
      domain: evidence.domain || sourceDomain(evidence.url),
      doc_name: evidence.doc_name,
      snippet: evidence.text || evidence.quote || evidence.snippet,
      authority: evidence.authority_score != null ? evidence.authority_score * 5 : null,
      kind: evidence.doc_name ? "doc" : "web",
      verdict: "reference_found",
      reason: "Citation ID resolves to a retrieved passage; claim entailment was not evaluated",
    });
  }

  for (const source of report.sources ?? []) {
    const id = source.source_id || source.id;
    if (!id || citations.has(id)) continue;
    citations.set(id, {
      id,
      title: source.title || source.domain || "Primary source",
      url: source.url,
      domain: source.domain || sourceDomain(source.url),
      authority: source.authority_tier != null ? source.authority_tier * 5 : null,
      kind: source.kind === "user_doc" || source.kind === "doc" ? "doc" : "web",
      snippet: source.snippet || "",
      verdict: "reference_found",
    });
  }

  return citations;
}

/** Merge artifact passages and normalized sources for the report inspector. */
export function buildReportSources(report: ReportData | null): ReportSource[] {
  if (!report) return [];
  const sourcesById = new Map<string, ReportSource>();
  for (const source of report.evidence_manifest ?? []) {
    const id = source.source_id || source.id;
    if (id) sourcesById.set(id, source);
  }
  for (const source of report.sources ?? []) {
    const id = source.source_id || source.id;
    if (id && !sourcesById.has(id)) sourcesById.set(id, source);
  }
  return [...sourcesById.values()];
}

/** Parses level-two markdown headings and makes duplicate section IDs unique. */
export function buildReportChapters(markdown: string): ReportChapter[] {
  if (!markdown) return [];
  const chapters: ReportChapter[] = [];
  const occurrences = new Map<string, number>();

  for (const line of markdown.split("\n")) {
    if (!line.startsWith("## ")) continue;
    const title = line
      .replace(/^##\s+/, "")
      .replace(/[`*_~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();
    const base = headingSlug(title);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    chapters.push({ id: occurrence ? `${base}-${occurrence + 1}` : base, title });
  }

  return chapters.length ? chapters : [{ id: "overview", title: "Executive Intelligence Briefing" }];
}

/** Normalizes provider and research warnings for a concise report banner. */
export function getReportWarnings(report: ReportData): string[] {
  const warnings = [
    ...(Array.isArray(report.research_warnings) ? report.research_warnings : []),
    ...(Array.isArray(report.provider_warnings) ? report.provider_warnings : []),
  ];
  return warnings.map((warning) => {
    if (typeof warning === "string") return warning;
    if (warning && typeof warning === "object") {
      const item = warning as Record<string, unknown>;
      return String(item.message || item.detail || "A research service was unavailable.");
    }
    return "A research service was unavailable.";
  });
}
