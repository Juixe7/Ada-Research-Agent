"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import AdaPrismLogo from "@/components/AdaPrismLogo";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !username || !password) return;

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    const res = await register(email, username, password);
    if (res.success) {
      router.push("/dashboard");
    } else {
      setErrorMsg(res.error || "Registration failed.");
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
                Create Ada Account
              </h1>
              <p className="text-xs text-[var(--ink-2)]">
                Set up your isolated research workspace and private vault.
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
                  Email Address
                </label>
                <input
                  type="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@organization.com"
                  className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--ink-2)] block">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="analyst_handle"
                  className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)] font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--ink-2)] block">
                  Password (min. 6 characters)
                </label>
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
                    <span>Creating workspace...</span>
                  </>
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="text-center text-xs text-[var(--ink-3)]">
            Already have an account?{" "}
            <Link href="/login" className="text-[var(--ink)] hover:text-[var(--accent)] underline underline-offset-4 decoration-[var(--line)] font-medium transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
