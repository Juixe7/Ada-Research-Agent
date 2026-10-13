"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, AlertCircle, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import AdaPrismLogo from "@/components/AdaPrismLogo";
import { API_URL } from "@/lib/config";

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || loading) return;

    setLoading(true);
    setErrorMsg("");
    setResetToken(null);

    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: loginId.trim() })
      });
      const data = await res.json();
      if (res.ok && data.reset_token) {
        setResetToken(data.reset_token);
      } else {
        setErrorMsg(data.detail || "No account found matching this identifier.");
      }
    } catch (err: any) {
      setErrorMsg("Failed to connect to authentication service.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToken = () => {
    if (!resetToken) return;
    navigator.clipboard.writeText(resetToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-zinc-100 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 flex items-center justify-center px-4 py-16">
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
                Reset Password
              </h1>
              <p className="text-xs text-zinc-400">
                Generate an on-screen token to restore access to your account.
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

            {!resetToken ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300 block">
                    Account Email or Username
                  </label>
                  <input
                    type="text"
                    autoFocus
                    required
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    placeholder="name@organization.com or username"
                    className="w-full bg-[#17181d] border border-white/[0.1] focus:border-white/30 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all font-sans"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !loginId.trim()}
                  className="w-full btn-primary py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Generating token...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Generate Reset Token</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              <div className="space-y-4 animate-in fade-in duration-150">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase text-zinc-400 font-semibold">
                      Your Reset Token (15 min)
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyToken}
                      className="text-[11px] font-mono text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {tokenCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{tokenCopied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <div className="p-3 bg-[#17181d] border border-white/[0.1] rounded-lg font-mono text-xs text-zinc-200 break-all select-all">
                    {resetToken}
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Email dispatch is disabled in this environment. Your secure one-time token is displayed above.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => router.push(`/reset-password?token=${encodeURIComponent(resetToken)}`)}
                  className="w-full btn-primary py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Proceed to Set New Password</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
