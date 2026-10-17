"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import Navbar from "@/components/Navbar";
import AdaPrismLogo from "@/components/AdaPrismLogo";
import { API_URL } from "@/lib/config";

export default function ForgotPasswordPage() {
  const [loginId, setLoginId] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loginId.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: loginId.trim() }),
      });
      if (!response.ok) throw new Error("We couldn't process that request. Please try again.");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to contact the account service.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <section className="w-full max-w-sm space-y-6">
          <Link href="/login" className="inline-flex items-center gap-2 text-sm text-[var(--ink-3)] hover:text-[var(--ink)]">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
          <div className="flex flex-col items-center text-center gap-3">
            <AdaPrismLogo size="md" showWordmark={false} />
            <div>
              <h1 className="font-serif text-2xl font-semibold">Reset your password</h1>
              <p className="mt-2 text-sm text-[var(--ink-2)]">We’ll send a secure reset link if an account matches.</p>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
            {submitted ? (
              <div className="space-y-3 text-center" role="status" aria-live="polite">
                <CheckCircle2 className="mx-auto h-6 w-6 text-[var(--ok)]" />
                <h2 className="font-medium">Check your inbox</h2>
                <p className="text-sm leading-relaxed text-[var(--ink-2)]">If an account matches that email or username, a reset link will arrive shortly. The link expires in 15 minutes.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && <p role="alert" className="text-sm text-[var(--bad)]">{error}</p>}
                <label className="block space-y-1.5 text-sm font-medium">
                  <span>Email or username</span>
                  <input
                    type="text"
                    autoComplete="username"
                    required
                    maxLength={254}
                    value={loginId}
                    onChange={(event) => setLoginId(event.target.value)}
                    placeholder="name@organization.com"
                    className="input-base w-full px-3 py-2.5 text-sm"
                  />
                </label>
                <button type="submit" disabled={loading || !loginId.trim()} className="btn-primary w-full rounded-md py-2.5 text-sm font-semibold disabled:opacity-50">
                  {loading ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Sending…</> : <><Mail className="mr-2 inline h-4 w-4" />Send reset link</>}
                </button>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
