import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/config";
import type { ResearchBlueprint } from "@/lib/api-types";

export type ResearchDepth = "quick" | "standard" | "deep";
export type ResearchDomain = "all" | "academic" | "financial" | "technical";

export interface ResearchLaunchRequest {
  query: string;
  depth: ResearchDepth;
  domain: ResearchDomain;
  includeDocs: boolean;
  selectedDocs: string[];
  sessionId: string | null;
}

interface ActiveResearchRequest extends ResearchLaunchRequest {
  preparedQuery: string;
}

interface ResearchLaunchResponse {
  report_id?: string;
  run_id?: string;
  job_id?: string;
}

interface ApiErrorResponse {
  detail?: string;
}

function buildFocusedQuery(query: string, domain: ResearchDomain): string {
  const cleanQuery = query.trim();
  if (domain === "academic" && !cleanQuery.toLowerCase().includes("academic")) {
    return `${cleanQuery} [Focus: peer-reviewed literature, academic research]`;
  }
  if (domain === "financial" && !cleanQuery.toLowerCase().includes("financial")) {
    return `${cleanQuery} [Focus: industry filings, market analysis, economic data]`;
  }
  if (domain === "technical" && !cleanQuery.toLowerCase().includes("technical")) {
    return `${cleanQuery} [Focus: technical specifications, engineering benchmarks, whitepapers]`;
  }
  return cleanQuery;
}

/** Coordinates preflight, scope recalibration, and dispatch for one research run. */
export function useResearchLaunch(token: string | null) {
  const router = useRouter();
  const inFlight = useRef(false);
  const recalibrationInFlight = useRef(false);
  const requestContext = useRef<ActiveResearchRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scopingModalOpen, setScopingModalOpen] = useState(false);
  const [blueprint, setBlueprint] = useState<ResearchBlueprint | null>(null);
  const [preparedQuery, setPreparedQuery] = useState("");
  const [recalibrating, setRecalibrating] = useState(false);
  const [recalibrationError, setRecalibrationError] = useState("");

  const dispatch = useCallback(async (
    context: ActiveResearchRequest,
    clarificationChoice: string | null,
    customAngles: string[],
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError("");

    const payload: Record<string, unknown> = {
      query: context.preparedQuery,
      depth: context.depth,
      include_user_docs: context.includeDocs,
      selected_docs: context.includeDocs ? context.selectedDocs : [],
    };
    if (clarificationChoice) payload.clarification_choice = clarificationChoice;
    if (customAngles.length > 0) payload.custom_angles = customAngles;
    if (context.sessionId) payload.session_id = context.sessionId;

    try {
      const response = await fetch(`${API_URL}/api/research`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const details = await response.json().catch((): ApiErrorResponse => ({}));
        throw new Error(details.detail || "Failed to start investigation");
      }

      const data = await response.json() as ResearchLaunchResponse;
      const runId = data.report_id || data.run_id || data.job_id;
      if (!runId) throw new Error("Missing report run ID from engine response");
      router.push(`/run/${encodeURIComponent(runId)}`);
    } catch (cause) {
      console.error("Research start failure:", cause);
      setError(cause instanceof Error ? cause.message : "Failed to initiate deep research");
      setLoading(false);
      inFlight.current = false;
    }
  }, [router, token]);

  const start = useCallback(async (request: ResearchLaunchRequest) => {
    if (!request.query.trim() || inFlight.current) return;

    const context: ActiveResearchRequest = {
      ...request,
      selectedDocs: [...request.selectedDocs],
      preparedQuery: buildFocusedQuery(request.query, request.domain),
    };
    requestContext.current = context;
    setPreparedQuery(context.preparedQuery);
    inFlight.current = true;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/research/preflight`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: context.preparedQuery,
          depth: context.depth,
          include_user_docs: context.includeDocs,
          selected_docs: context.includeDocs ? context.selectedDocs : [],
        }),
      });
      if (!response.ok) throw new Error("Preflight check failed");
      setBlueprint(await response.json() as ResearchBlueprint);
      setScopingModalOpen(true);
      setLoading(false);
      inFlight.current = false;
    } catch (cause) {
      // Preserve the existing graceful fallback when optional scoping is unavailable.
      console.warn("Preflight check bypassed, dispatching directly:", cause);
      inFlight.current = false;
      await dispatch(context, null, []);
    }
  }, [dispatch, token]);

  const confirm = useCallback((clarificationChoice: string | null, customAngles: string[]) => {
    const context = requestContext.current;
    setScopingModalOpen(false);
    if (context) void dispatch(context, clarificationChoice, customAngles);
  }, [dispatch]);

  const skip = useCallback(() => {
    const context = requestContext.current;
    setScopingModalOpen(false);
    if (context) void dispatch(context, null, []);
  }, [dispatch]);

  const recalibrate = useCallback(async (modificationText: string): Promise<boolean> => {
    const context = requestContext.current;
    if (!context || recalibrationInFlight.current) return false;
    recalibrationInFlight.current = true;
    setRecalibrating(true);
    setRecalibrationError("");
    try {
      const response = await fetch(`${API_URL}/api/research/preflight`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: context.preparedQuery,
          depth: context.depth,
          include_user_docs: context.includeDocs,
          selected_docs: context.includeDocs ? context.selectedDocs : [],
          user_modification: modificationText,
        }),
      });
      if (!response.ok) throw new Error("Could not update the research scope. Please try again.");
      setBlueprint(await response.json() as ResearchBlueprint);
      return true;
    } catch (cause) {
      console.error("Recalibrate failed:", cause);
      setRecalibrationError(cause instanceof Error ? cause.message : "Could not update the research scope.");
      return false;
    } finally {
      setRecalibrating(false);
      recalibrationInFlight.current = false;
    }
  }, [token]);

  const closeScoping = useCallback(() => setScopingModalOpen(false), []);
  return {
    loading,
    error,
    scopingModalOpen,
    blueprint,
    preparedQuery,
    recalibrating,
    recalibrationError,
    start,
    confirm,
    skip,
    recalibrate,
    closeScoping,
  };
}
