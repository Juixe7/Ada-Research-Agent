import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_URL } from "@/lib/config";
import type { DocPreview, VaultDoc } from "@/lib/vault-types";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".csv"]);

interface VaultResponse<T> {
  detail?: string;
  documents?: T;
  [key: string]: unknown;
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as VaultResponse<T>;
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed (${response.status}).`);
  }
  return payload as T;
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Owns authenticated source-library reads and mutations for the vault page. */
export function useVaultLibrary(token: string | null, authLoading: boolean) {
  const [documents, setDocuments] = useState<VaultDoc[]>([]);
  const [loadedDocumentsToken, setLoadedDocumentsToken] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedDocName, setSelectedDocName] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [reindexingDoc, setReindexingDoc] = useState<string | null>(null);

  const previewRequestId = useRef(0);
  const documentsRequestId = useRef(0);
  const selectedDocNameRef = useRef<string | null>(null);
  const loading = authLoading || Boolean(token && loadedDocumentsToken !== token);

  const openPreview = useCallback(async (docName: string) => {
    if (!token) return;
    const requestId = ++previewRequestId.current;
    selectedDocNameRef.current = docName;
    setSelectedDocName(docName);
    setPreviewDoc(null);
    setLoadingPreview(true);
    setPreviewError(null);

    try {
      const response = await fetch(`${API_URL}/api/vault/${encodeURIComponent(docName)}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readResponse<DocPreview>(response);
      if (requestId === previewRequestId.current) setPreviewDoc(data);
    } catch (error: unknown) {
      if (requestId === previewRequestId.current) {
        setPreviewError(messageFrom(error, "Unable to read document content."));
      }
    } finally {
      if (requestId === previewRequestId.current) setLoadingPreview(false);
    }
  }, [token]);

  const refreshDocuments = useCallback(async () => {
    if (!token) return [];
    const requestId = ++documentsRequestId.current;
    try {
      const response = await fetch(`${API_URL}/api/vault`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await readResponse<{ documents?: VaultDoc[] }>(response);
      const nextDocuments = payload.documents ?? [];
      if (requestId !== documentsRequestId.current) return nextDocuments;
      setDocuments(nextDocuments);
      if (nextDocuments.length && !selectedDocNameRef.current) {
        void openPreview(nextDocuments[0].doc_name);
      }
      setErrorMsg("");
      return nextDocuments;
    } catch (error: unknown) {
      if (requestId === documentsRequestId.current) {
        setErrorMsg(messageFrom(error, "Could not load your source library."));
      }
      return [];
    } finally {
      if (requestId === documentsRequestId.current) setLoadedDocumentsToken(token);
    }
  }, [token, openPreview]);

  useEffect(() => {
    if (authLoading || !token) return;
    const request = window.setTimeout(() => void refreshDocuments(), 0);
    return () => {
      window.clearTimeout(request);
      documentsRequestId.current += 1;
    };
  }, [authLoading, token, refreshDocuments]);

  const uploadDocument = useCallback(async (file: File): Promise<boolean> => {
    if (uploading) return false;
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      setErrorMsg("Choose a PDF, DOCX, TXT, Markdown, or CSV file.");
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMsg("This file is larger than the 20 MB limit.");
      return false;
    }
    if (!token) {
      setErrorMsg("Sign in again to add a source.");
      return false;
    }

    setUploading(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const payload = await readResponse<{ message?: string; filename?: string }>(response);
      setStatusMsg(payload.message || `Added ${file.name} to your research library.`);
      await refreshDocuments();
      if (payload.filename) void openPreview(payload.filename);
      return true;
    } catch (error: unknown) {
      setErrorMsg(messageFrom(error, "Upload failed."));
      return false;
    } finally {
      setUploading(false);
    }
  }, [token, uploading, refreshDocuments, openPreview]);

  const addNote = useCallback(async (title: string, text: string) => {
    if (!text.trim() || pasting) return false;
    if (!token) {
      setErrorMsg("Sign in again to add a note.");
      return false;
    }
    setPasting(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      const response = await fetch(`${API_URL}/api/paste-document`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "Private Research Memo", text }),
      });
      const payload = await readResponse<{ doc_name?: string }>(response);
      setStatusMsg("Your research note was added to the source library.");
      await refreshDocuments();
      if (payload.doc_name) void openPreview(payload.doc_name);
      return true;
    } catch (error: unknown) {
      setErrorMsg(messageFrom(error, "Failed to process text memo."));
      return false;
    } finally {
      setPasting(false);
    }
  }, [token, pasting, refreshDocuments, openPreview]);

  const reindexDocument = useCallback(async (docName: string) => {
    if (!token || reindexingDoc) return;
    setReindexingDoc(docName);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const response = await fetch(`${API_URL}/api/vault/${encodeURIComponent(docName)}/reindex`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await readResponse<{ chunks_indexed?: number }>(response);
      setStatusMsg(`Indexed ${payload.chunks_indexed || 0} searchable passages.`);
      await refreshDocuments();
      await openPreview(docName);
    } catch (error: unknown) {
      setErrorMsg(messageFrom(error, "Could not index this source."));
    } finally {
      setReindexingDoc(null);
    }
  }, [token, reindexingDoc, refreshDocuments, openPreview]);

  const deleteDocument = useCallback(async (docName: string) => {
    if (!token) return false;
    try {
      const response = await fetch(`${API_URL}/api/vault/${encodeURIComponent(docName)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await readResponse<{ message?: string }>(response);
      setDocuments(current => current.filter(document => document.doc_name !== docName));
      if (selectedDocNameRef.current === docName) {
        previewRequestId.current += 1;
        selectedDocNameRef.current = null;
        setPreviewDoc(null);
        setSelectedDocName(null);
        setLoadingPreview(false);
        setPreviewError(null);
      }
      setStatusMsg(`Removed "${docName}" from vault.`);
      setErrorMsg("");
      return true;
    } catch (error: unknown) {
      setErrorMsg(messageFrom(error, "Could not remove this source."));
      return false;
    }
  }, [token]);

  const totalSizeKb = useMemo(
    () => documents.reduce((total, document) => total + (document.size_kb || 0), 0),
    [documents],
  );

  return {
    documents, loading, totalSizeKb, statusMsg, errorMsg,
    selectedDocName, previewDoc, loadingPreview, previewError,
    uploading, pasting, reindexingDoc,
    openPreview, refreshDocuments, uploadDocument, addNote, reindexDocument, deleteDocument,
    clearStatus: () => setStatusMsg(""),
    clearError: () => setErrorMsg(""),
  };
}
