"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import AdaPrismLogo from "@/components/AdaPrismLogo";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId || !password) return;

    setLoading(true);
    setErrorMsg("");

    const res = await login(loginId, password);
    if (res.success) {
      const requestedPath = new URLSearchParams(window.location.search).get("redirect");
      const safePath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/dashboard";
      router.replace(safePath);
    } else {
      setErrorMsg(res.error || "Invalid username or password.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      <Navbar />

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center justify-start">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to home</span>
            </Link>
          </div>

          <div className="flex flex-col items-center text-center space-y-3">
            <AdaPrismLogo size="md" showWordmark={false} />
            <div className="space-y-1">
              <h1 className="text-xl font-serif font-bold text-[var(--ink)] tracking-tight">
                Sign In to Ada
              </h1>
              <p className="text-xs text-[var(--ink-2)]">
                Access your research desk, private vault, and dossiers.
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--ink-2)] block">
                  Email or Username
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="name@organization.com or username"
                  className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--ink-2)]">
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-[11px] text-[var(--ink-3)] hover:text-[var(--accent)] transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)] font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-2.5 rounded-[6px] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="text-center text-xs text-[var(--ink-3)]">
            Don&apos;t have an account yet?{" "}
            <Link href="/register" className="text-[var(--ink)] hover:text-[var(--accent)] underline underline-offset-4 decoration-[var(--line)] font-medium transition-colors">
              Create an account
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
