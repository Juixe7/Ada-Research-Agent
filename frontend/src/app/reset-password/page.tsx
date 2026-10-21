"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, AlertCircle, CheckCircle2, Lock, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import AdaPrismLogo from "@/components/AdaPrismLogo";
import { API_URL } from "@/lib/config";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [token, setToken] = useState(() => searchParams.get("token") ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !newPassword || loading) return;

    if (newPassword.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          new_password: newPassword
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessMsg("Password reset successfully. Redirecting to sign in...");
        setTimeout(() => {
          router.push("/login");
        }, 2000);
      } else {
        setErrorMsg(data.detail || "Password reset failed. Token may be invalid or expired.");
      }
    } catch {
      setErrorMsg("Failed to connect to authentication service.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex items-center justify-start">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to sign in</span>
        </Link>
      </div>

      <div className="flex flex-col items-center text-center space-y-3">
        <AdaPrismLogo size="md" showWordmark={false} />
        <div className="space-y-1">
          <h1 className="text-xl font-serif font-bold text-[var(--ink)] tracking-tight">
            Set New Password
          </h1>
          <p className="text-xs text-[var(--ink-2)]">
            Enter your reset token and define a new secure password.
          </p>
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[10px] p-6 shadow-sm space-y-5">
        {errorMsg && (
          <div className="p-3 rounded-[6px] bg-[var(--bad-soft)] border border-[var(--bad)] text-[var(--bad)] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-[6px] bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {!successMsg ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--ink-2)] block">
                Reset Token
              </label>
              <input
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your 15-minute reset token"
                className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)] font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--ink-2)] block">
                New Password (min 6 characters)
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--ink-2)] block">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)]"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !token.trim() || !newPassword}
              className="w-full btn-primary py-2.5 rounded-[6px] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Updating password...</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Update Password</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="text-center pt-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-2)] hover:text-[var(--ink)] font-medium underline underline-offset-4"
            >
              <span>Click here if not redirected automatically</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <Suspense fallback={<div className="text-xs text-[var(--ink-3)]">Loading form...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </main>
    </div>
  );
}
