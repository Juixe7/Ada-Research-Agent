"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  User, Key, CheckCircle2, AlertCircle, Loader2, 
  LogOut, Shield, ArrowLeft
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { formatDossierDate } from "@/lib/config";

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
      <div className="min-h-screen bg-[var(--paper)] flex items-center justify-center font-mono text-xs text-[var(--ink-3)]">
        <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-quiet-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      <Navbar />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 md:py-16 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)]">
              <Shield className="w-3.5 h-3.5 text-[var(--ink-2)]" />
              <span>Workspace Security & Credentials</span>
            </div>
            <h1 className="text-2xl font-serif font-bold text-[var(--ink)] tracking-tight">
              Account Settings
            </h1>
          </div>

          <Link
            href="/dashboard"
            className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)] flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Profile Overview Card */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[10px] p-6 space-y-5">
            <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-[var(--ink-2)]" />
              <span>Identity Profile</span>
            </h2>

            <div className="space-y-4 text-xs">
              <div>
                <span className="text-[11px] text-[var(--ink-3)] block">Username</span>
                <span className="font-semibold text-[var(--ink)] text-sm mt-0.5 block">{user.username}</span>
              </div>

              <div>
                <span className="text-[11px] text-[var(--ink-3)] block">Email Address</span>
                <span className="font-mono text-[var(--ink-2)] text-xs mt-0.5 block">{user.email}</span>
              </div>

              <div>
                <span className="text-[11px] text-[var(--ink-3)] block">Account ID</span>
                <span className="font-mono text-[var(--ink-4)] text-[10px] truncate block mt-0.5">{user.id}</span>
              </div>

              {user.created_at && (
                <div>
                  <span className="text-[11px] text-[var(--ink-3)] block">Member Since</span>
                  <span className="font-mono text-[var(--ink-2)] text-xs mt-0.5 block">
                    {formatDossierDate(user.created_at)}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[var(--line)]">
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[6px] bg-[var(--surface-2)] hover:bg-[var(--bad-soft)] text-[var(--ink-2)] hover:text-[var(--bad)] text-xs font-medium border border-[var(--line)] transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out of Session</span>
              </button>
            </div>
          </div>

          {/* Change Password Card */}
          <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--line)] rounded-[10px] p-6 space-y-6">
            <div className="space-y-1">
              <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-[var(--ink-2)]" />
                <span>Security & Password</span>
              </h2>
              <p className="text-xs text-[var(--ink-2)]">
                Change your password to protect your workspace and saved research.
              </p>
            </div>

            {successMsg && (
              <div className="p-3 rounded-[6px] bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-[6px] bg-[var(--bad-soft)] border border-[var(--bad)] text-[var(--bad)] text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <label htmlFor="current-password" className="text-xs font-medium text-[var(--ink-2)] block">
                  Current Password
                </label>
                <input
                  id="current-password"
                  name="current-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)]"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="new-password" className="text-xs font-medium text-[var(--ink-2)] block">
                  New Password
                </label>
                <input
                  id="new-password"
                  name="new-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)]"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirm-new-password" className="text-xs font-medium text-[var(--ink-2)] block">
                  Confirm New Password
                </label>
                <input
                  id="confirm-new-password"
                  name="confirm-new-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter the new password"
                  className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)]"
                />
              </div>

              <button
                type="submit"
                disabled={passwordLoading}
                className="btn-primary px-5 py-2.5 rounded-[6px] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer mt-2 disabled:opacity-50"
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
