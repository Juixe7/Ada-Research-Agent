export interface RunSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  date?: string;
  authorityDots: number | null;
  isVault: boolean;
  excerpt?: string;
  trackId?: string | number;
  isNew?: boolean;
}

export type RunStatus = "loading" | "running" | "completed" | "failed" | "cancelled";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  stage: string;
  type: string;
  text: string;
  rawQuery?: string;
  domain?: string;
  criticFinding?: {
    claim?: string;
    conflictingValues?: string[];
    resolution?: string;
  };
}

export interface ResearchBudgetUsage {
  searches_used: number;
  searches_limit: number;
  fetches_used: number;
  fetches_limit: number;
  seconds_used?: number;
  seconds_limit?: number;
  limits_reached?: string[];
}

export interface RunEventPayload {
  status?: string;
  stage?: string;
  progress?: number;
  query?: string;
  tokens_used?: number;
  tokens?: number;
  tokens_in?: number;
  tokens_out?: number;
  agent?: string;
  latency_ms?: number;
  title?: string;
  url?: string;
  domain?: string;
  authority?: number;
  authority_score?: number;
  source_type?: string;
  is_vault?: boolean;
  excerpt?: string;
  snippet?: string;
  published_date?: string;
  count?: number;
  total_evidence_units?: number;
  message?: string;
  detail?: string;
  error?: string;
  finding?: { claim?: string; conflicting_values?: string[]; resolution?: string };
  section_title?: string;
  queries?: string[];
  category?: string;
  track_id?: string | number;
  sub_question?: string;
  budget?: Partial<ResearchBudgetUsage>;
}

export interface IncomingRunEvent {
  event?: string;
  type?: string;
  data?: RunEventPayload;
}

export interface RunStatusSnapshot {
  status?: string;
  stage?: string;
  query?: string;
  budget_usage?: Partial<ResearchBudgetUsage>;
}
