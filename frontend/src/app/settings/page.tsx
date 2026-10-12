"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  User, Key, CheckCircle2, AlertCircle, Loader2, 
  LogOut, Shield, ArrowLeft
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";

export default function SettingsPage() {
  const { user, loading: authLoading, changePassword, logout } = useAuth();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Guard: if unauthenticated, redirect to login
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;

    if (newPassword.length < 6) {
      setErrorMsg("New password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg("New passwords do not match.");
      return;
    }

    setPasswordLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const res = await changePassword(currentPassword, newPassword);
    if (res.success) {
      setSuccessMsg("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setErrorMsg(res.error || "Failed to update password.");
    }
    setPasswordLoading(false);
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#0a0b0d] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-zinc-100 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 md:py-16 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              <Shield className="w-3.5 h-3.5 text-zinc-300" />
              <span>Workspace Security & Credentials</span>
            </div>
            <h1 className="text-2xl font-serif font-bold text-zinc-100 tracking-tight">
              Account Settings
            </h1>
          </div>

          <a
            href="/dashboard"
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Profile Overview Card */}
          <div className="bg-[#121316] border border-white/[0.08] rounded-xl p-6 space-y-5">
            <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-zinc-300" />
              <span>Identity Profile</span>
            </h2>

            <div className="space-y-4 text-xs">
              <div>
                <span className="text-[11px] text-zinc-500 block">Username</span>
                <span className="font-semibold text-zinc-200 text-sm mt-0.5 block">{user.username}</span>
              </div>

              <div>
                <span className="text-[11px] text-zinc-500 block">Email Address</span>
                <span className="font-mono text-zinc-300 text-xs mt-0.5 block">{user.email}</span>
              </div>

              <div>
                <span className="text-[11px] text-zinc-500 block">Account ID</span>
                <span className="font-mono text-zinc-500 text-[10px] truncate block mt-0.5">{user.id}</span>
              </div>

              {user.created_at && (
                <div>
                  <span className="text-[11px] text-zinc-500 block">Member Since</span>
                  <span className="font-mono text-zinc-400 text-xs mt-0.5 block">
                    {new Date(user.created_at).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-red-500/10 text-zinc-300 hover:text-red-400 text-xs font-medium border border-white/[0.08] transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out of Session</span>
              </button>
            </div>
          </div>

          {/* Change Password Card */}
          <div className="md:col-span-2 bg-[#121316] border border-white/[0.08] rounded-xl p-6 space-y-6">
            <div className="space-y-1">
              <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-zinc-300" />
                <span>Security & Password</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Update your account password to protect access to your private research dossiers.
              </p>
            </div>

            {successMsg && (
              <div className="p-3 rounded-lg bg-white/[0.05] border border-white/[0.12] text-zinc-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-zinc-300" />
                <span>{successMsg}</span>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 block">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[#17181d] border border-white/[0.1] focus:border-white/30 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 block">
                  New Password
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
                disabled={passwordLoading}
                className="btn-primary px-5 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:opacity-50"
              >
                {passwordLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Updating password...</span>
                  </>
                ) : (
                  <span>Update Password</span>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
