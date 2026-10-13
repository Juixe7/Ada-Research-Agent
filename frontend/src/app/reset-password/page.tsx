"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, AlertCircle, CheckCircle2, Lock, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import AdaPrismLogo from "@/components/AdaPrismLogo";
import { API_URL } from "@/lib/config";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    const queryToken = searchParams.get("token");
    if (queryToken) {
      setToken(queryToken);
    }
  }, [searchParams]);

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
    } catch (err: any) {
      setErrorMsg("Failed to connect to authentication service.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex items-center justify-start">
        <a
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to sign in</span>
        </a>
      </div>

      <div className="flex flex-col items-center text-center space-y-3">
        <AdaPrismLogo size="md" showWordmark={false} />
        <div className="space-y-1">
          <h1 className="text-xl font-serif font-bold text-zinc-100 tracking-tight">
            Set New Password
          </h1>
          <p className="text-xs text-zinc-400">
            Enter your reset token and define a new secure password.
          </p>
        </div>
      </div>

      <div className="bg-[#121316] border border-white/[0.08] rounded-xl p-6 shadow-2xl space-y-5">
        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        {!successMsg ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 block">
                Reset Token
              </label>
              <input
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your 15-minute reset token"
                className="w-full bg-[#17181d] border border-white/[0.1] focus:border-white/30 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 block">
                New Password (min 6 characters)
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[#17181d] border border-white/[0.1] focus:border-white/30 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all font-sans"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 block">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[#17181d] border border-white/[0.1] focus:border-white/30 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all font-sans"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !token.trim() || !newPassword}
              className="w-full btn-primary py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:opacity-50"
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
            <a
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-200 hover:text-white font-medium underline underline-offset-4"
            >
              <span>Click here if not redirected automatically</span>
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[#0a0b0d] text-zinc-100 flex flex-col font-sans">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <Suspense fallback={<div className="text-xs text-zinc-400">Loading form...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </main>
    </div>
  );
}
