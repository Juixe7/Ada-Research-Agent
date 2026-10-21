import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/config";
import type { FollowupThread } from "@/lib/report-types";

interface FollowupResponse {
  answer: string;
  citations?: string[];
  verification_status?: string;
  status?: string;
}

interface FollowupErrorResponse {
  detail?: string;
}

/**
 * Owns the evidence-backed follow-up conversation for a report.
 * Aborts the active request when the report view unmounts or its identity changes.
 */
export function useReportFollowups(
  reportId: string,
  token: string | null,
  onError: (message: string) => void,
) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [threads, setThreads] = useState<FollowupThread[]>([]);
  const [selectedText, setSelectedText] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const submitting = useRef(false);

  useEffect(() => () => activeRequest.current?.abort(), [reportId]);

  const submit = useCallback(async () => {
    const question = query.trim();
    if (!question || submitting.current) return;

    submitting.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/report/${reportId}/query-evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, selected_text: selectedText }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const details = await response.json().catch((): FollowupErrorResponse => ({}));
        throw new Error(details.detail || "Unable to answer from this report's evidence.");
      }

      const data = await response.json() as FollowupResponse;
      setThreads((current) => [
        ...current,
        {
          id: Date.now(),
          question,
          answer: data.answer,
          path: data.verification_status === "verified"
            ? "Checked against report evidence"
            : data.status === "insufficient_evidence"
              ? "No supporting report evidence"
              : "Citations checked · entailment uncertain",
          citations: data.citations || [],
          verificationStatus: data.verification_status,
        },
      ]);
      setQuery("");
      setSelectedText("");
    } catch (error) {
      if (!controller.signal.aborted) {
        onError(error instanceof Error ? error.message : "Follow-up investigation failed.");
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      submitting.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [onError, query, reportId, selectedText, token]);

  return {
    query,
    setQuery,
    loading,
    threads,
    selectedText,
    setSelectedText,
    submit,
  };
}
