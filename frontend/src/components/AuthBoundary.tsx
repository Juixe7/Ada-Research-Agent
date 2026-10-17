"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const PRIVATE_PATHS = ["/dashboard", "/studio", "/vault", "/history", "/settings", "/run"];

function requiresAuthentication(pathname: string) {
  return PRIVATE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export default function AuthBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isPrivate = requiresAuthentication(pathname);

  useEffect(() => {
    if (loading || user || !isPrivate) return;
    const returnTo = `${pathname}${window.location.search}`;
    router.replace(`/login?redirect=${encodeURIComponent(returnTo)}`);
  }, [isPrivate, loading, pathname, router, user]);

  if (loading || (isPrivate && !user)) {
    return (
      <main className="min-h-screen grid place-items-center bg-[var(--paper)] px-6" aria-live="polite" aria-busy="true">
        <div className="flex items-center gap-3 text-sm text-[var(--ink-2)]">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] animate-quiet-pulse" aria-hidden="true" />
          <span>{loading ? "Restoring your workspace…" : "Taking you to sign in…"}</span>
        </div>
      </main>
    );
  }

  return children;
}
