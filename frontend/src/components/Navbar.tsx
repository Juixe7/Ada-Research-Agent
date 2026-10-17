"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { 
  FolderArchive, Settings, ChevronDown, Plus, LogOut, Menu, X
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AdaPrismLogo from "@/components/AdaPrismLogo";

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDropdownOpen(false);
    setMobileNavOpen(false);
  }, [pathname]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const navLinks = user ? [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/studio",    label: "Research" },
    { href: "/vault",     label: "Library" },
    { href: "/history",   label: "History" },
  ] : [
    { href: "/#features",     label: "Features" },
    { href: "/#how-it-works", label: "How It Works" },
    { href: "/architecture",  label: "Architecture" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[var(--line)] bg-[var(--paper)] transition-colors">
      <nav className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-8">
        {/* Brand Wordmark with Generous Presence */}
        <div className="flex items-center gap-8">
          <Link
            href={user ? "/dashboard" : "/"}
            className="group flex items-center transition-opacity hover:opacity-90 focus:outline-none"
            aria-label="Ada Research Desk"
          >
            <AdaPrismLogo size="sm" showWordmark={true} />
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-1.5">
            {navLinks.map(({ href, label }) => {
              const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setMobileNavOpen(false)}
                  className={`
                    px-3 py-1.5 rounded-[6px] text-xs font-medium transition-all
                    ${isActive
                      ? "text-[var(--ink)] bg-[var(--surface-2)] font-semibold border border-[var(--line)]"
                      : "text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    }
                  `}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {/* Quick Launch Button */}
              <Link
                href="/studio"
                className="btn-primary"
                aria-label="Start new research"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New research</span>
              </Link>

              {/* User Avatar Menu */}
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 p-1 rounded-[6px] hover:bg-[var(--surface-2)] border border-transparent hover:border-[var(--line)] transition-all cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-mono font-medium flex items-center justify-center">
                    {user.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline text-xs text-[var(--ink-2)] font-medium max-w-[120px] truncate">
                    {user.username}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--ink-3)]" />
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-[10px] bg-[var(--surface)] border border-[var(--line-strong)] shadow-xl p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-100 z-50 text-[var(--ink)]">
                    <div className="px-3 py-2 border-b border-[var(--line)]">
                      <p className="text-xs font-semibold text-[var(--ink)] truncate">{user.username}</p>
                      <p className="text-[11px] text-[var(--ink-3)] font-mono truncate">{user.email}</p>
                    </div>

                    <Link
                      href="/settings"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 rounded-[6px] text-xs text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5 text-[var(--accent)]" />
                      <span>Account Settings</span>
                    </Link>

                    <Link
                      href="/vault"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 rounded-[6px] text-xs text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors"
                    >
                      <FolderArchive className="w-3.5 h-3.5 text-[var(--accent)]" />
                      <span>Source library</span>
                    </Link>

                    <button
                      type="button"
                      onClick={() => {
                        setDropdownOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-[6px] text-xs text-[var(--bad)] hover:bg-[var(--bad-soft)] transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="px-3.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="btn-primary text-xs px-3.5 py-1.5 rounded-[6px] shadow-xs"
              >
                Get Started
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] md:hidden"
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-primary-navigation"
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>

        {mobileNavOpen && (
          <div id="mobile-primary-navigation" className="absolute left-0 right-0 top-16 z-50 border-b border-[var(--line)] bg-[var(--surface)] p-3 shadow-lg md:hidden">
            <div className="mx-auto flex max-w-6xl flex-col gap-1">
              {navLinks.map(({ href, label }) => {
                const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setMobileNavOpen(false)}
                    className={`rounded-md px-3 py-2.5 text-sm transition-colors ${isActive ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"}`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
