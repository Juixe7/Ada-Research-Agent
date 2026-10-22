/** Minimal response shapes consumed by the frontend API clients. */
export interface ResearchReportSummary {
  report_id: string;
  session_id?: string | null;
  query?: string | null;
  executive_title?: string | null;
  status?: string | null;
  depth?: string | null;
  progress?: number | null;
  stage?: string | null;
  faithfulness_score?: number | null;
  coverage_score?: number | null;
  total_sources_cited?: number | null;
  is_public?: boolean | null;
  created_at?: string | null;
}

export interface ResearchReportListResponse {
  reports: ResearchReportSummary[];
}

export interface VaultDocumentSummary {
  doc_name: string;
  filename: string;
  size_kb: number;
  uploaded_at: number;
  chunk_count: number;
  index_status: "searchable" | "not_indexed";
}

export interface VaultListResponse {
  documents: VaultDocumentSummary[];
}

export interface VaultUploadResponse {
  status: "success";
  filename: string;
  chunks_indexed: number;
  message: string;
}

export interface VaultPasteResponse {
  status: "success";
  title: string;
  doc_name: string;
  chunks_indexed: number;
}

export interface VaultReindexResponse {
  status: "success";
  doc_name: string;
  chunks_indexed: number;
  message: string;
}

export interface VaultDeleteResponse {
  status: "success";
  doc_name: string;
}

export interface VaultPassage {
  chunk_id?: string | null;
  page_number?: number;
  section_path?: string | null;
  chunk_index?: number;
  text: string;
  char_count?: number;
}

export interface VaultPreviewResponse {
  doc_name: string;
  filename: string;
  size_kb: number;
  page_count: number;
  char_count: number;
  chunks_indexed: number;
  text: string;
  chunks: VaultPassage[];
}

export interface ClarificationChoice {
  id: string;
  title: string;
  description?: string;
}

export interface ResearchAngleOption {
  id: number | string;
  title: string;
  description?: string;
  source_scope?: string;
  enabled?: boolean;
}

export interface ResearchBlueprint {
  status?: string;
  ambiguity_detected?: boolean;
  ambiguity_explanation?: string;
  clarification_options?: ClarificationChoice[];
  research_angles?: ResearchAngleOption[];
  suggested_perspective?: string;
  estimated_duration_seconds?: number;
  warning?: string;
  ambiguity_sources?: {
    vault?: { doc_name?: string; snippet?: string };
    web?: { entity?: string; snippet?: string };
  };
}
