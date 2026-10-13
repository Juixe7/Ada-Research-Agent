"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
    <div className="min-h-screen bg-[#0a0b0d] text-zinc-100 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center justify-start">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to home</span>
            </a>
          </div>

          <div className="flex flex-col items-center text-center space-y-3">
            <AdaPrismLogo size="md" showWordmark={false} />
            <div className="space-y-1">
              <h1 className="text-xl font-serif font-bold text-zinc-100 tracking-tight">
                Create Ada Account
              </h1>
              <p className="text-xs text-zinc-400">
                Set up your isolated research workspace and private vault.
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 block">
                  Email Address
                </label>
                <input
                  type="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@organization.com"
                  className="w-full bg-[#17181d] border border-white/[0.1] focus:border-white/30 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 block">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="researcher"
                  className="w-full bg-[#17181d] border border-white/[0.1] focus:border-white/30 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 block">
                  Password (min 6 characters)
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[#17181d] border border-white/[0.1] focus:border-white/30 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all font-sans"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Creating account...</span>
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

          <div className="text-center text-xs text-zinc-400">
            Already have an account?{" "}
            <a href="/login" className="text-zinc-200 hover:text-white underline underline-offset-4 decoration-white/20 font-medium transition-colors">
              Sign In
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
