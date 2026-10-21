/** API response shapes used by the private source library and its preview panel. */

export interface VaultDoc {
  doc_name: string;
  filename?: string;
  size_kb: number;
  chunk_count?: number;
  uploaded_at?: string | number;
  created_at?: string | number;
  status?: string;
}

export interface DocPreview {
  doc_name: string;
  filename: string;
  size_kb: number;
  page_count: number;
  char_count: number;
  chunks_indexed: number;
  text: string;
  chunks: Array<{
    chunk_id?: string;
    page_number?: number;
    section_path?: string;
    chunk_index?: number;
    text: string;
    score?: number;
  }>;
}
