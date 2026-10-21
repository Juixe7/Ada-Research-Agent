export interface ReportSource {
  source_id?: string;
  id?: string;
  title?: string;
  doc_name?: string;
  url?: string | null;
  domain?: string;
  text?: string;
  quote?: string;
  snippet?: string;
  authority_score?: number | null;
  authority_tier?: number | null;
  kind?: string;
}

export interface ReportScores {
  [score: string]: number | null | undefined;
  faithfulness?: number | null;
  relevancy?: number | null;
  authority?: number | null;
  coverage?: number | null;
}

export interface ReportData {
  monograph?: string;
  report_markdown?: string;
  executive_title?: string;
  query?: string;
  depth?: string;
  created_at?: string;
  sources?: ReportSource[];
  evidence_manifest?: ReportSource[];
  scores?: ReportScores;
  faithfulness_score?: number | null;
  relevancy_score?: number | null;
  authority_score?: number | null;
  coverage_score?: number | null;
  citation_validity_score?: number | null;
  guard_results?: { citation_validity_score?: number | null; hallucinated_sources_count?: number | null };
  research_warnings?: unknown[];
  provider_warnings?: unknown[];
  is_public?: boolean;
  findings?: Array<{
    id?: string;
    type?: string;
    round?: number;
    status?: string;
    description?: string;
    resolution_note?: string;
  }>;
}

export interface CitationDetails {
  id: string;
  title: string;
  url?: string | null;
  domain: string;
  doc_name?: string;
  snippet?: string;
  authority?: number | null;
  kind: "doc" | "web";
  verdict: string;
  reason?: string;
}

export interface FollowupThread {
  id: number;
  question: string;
  answer: string;
  path: string;
  citations: string[];
  verificationStatus?: string;
}

export interface ReportChapter {
  id: string;
  title: string;
}
