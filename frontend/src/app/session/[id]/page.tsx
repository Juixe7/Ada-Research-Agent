"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";

export default function SessionRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.id;
  const router = useRouter();
  const { token, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/sessions/${sessionId}`, { headers })
      .then((res) => {
        if (!res.ok) throw new Error("Session not found");
        return res.json();
      })
      .then((data) => {
        if (data.turns && data.turns.length > 0) {
          const latestTurn = data.turns[data.turns.length - 1];
          router.replace(`/report/${latestTurn.id}`);
        } else {
          router.replace(`/studio?session_id=${sessionId}`);
        }
      })
      .catch((err) => {
        console.error("Session redirect failed:", err);
        router.replace("/dashboard");
      });
  }, [sessionId, token, loading, router]);

  return (
    <div className="min-h-screen bg-[#0c0d12] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-white/20 border-t-zinc-200 rounded-full animate-spin" />
    </div>
  );
}
