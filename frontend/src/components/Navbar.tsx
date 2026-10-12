"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { 
  FolderArchive, Settings, ChevronDown, Plus, LogOut
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AdaPrismLogo from "@/components/AdaPrismLogo";

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    { href: "/studio",    label: "Studio" },
    { href: "/vault",     label: "Vault" },
    { href: "/history",   label: "Dossiers" },
  ] : [
    { href: "/#features",     label: "Features" },
    { href: "/#how-it-works", label: "How It Works" },
    { href: "/architecture",  label: "Architecture" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.08] bg-[#0c0d12]/90 backdrop-blur-md transition-all">
      <nav className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6 sm:px-8">
        {/* Brand Wordmark with Generous Presence */}
        <div className="flex items-center gap-10">
          <a
            href={user ? "/dashboard" : "/"}
            className="group flex items-center transition-opacity hover:opacity-90 focus:outline-none"
            aria-label="Ada Research"
          >
            <AdaPrismLogo size="md" showWordmark={true} />
          </a>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-2">
            {navLinks.map(({ href, label }) => {
              const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
              return (
                <a
                  key={href}
                  href={href}
                  className={`
                    px-3.5 py-2 rounded-lg text-xs font-medium transition-all
                    ${isActive
                      ? "text-zinc-100 bg-white/[0.08] font-semibold border border-white/[0.12]"
                      : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]"
                    }
                  `}
                >
                  {label}
                </a>
              );
            })}
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {/* Quick Launch Button */}
              <a
                href="/studio"
                className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-200 hover:bg-white text-zinc-950 font-medium text-xs transition-all cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5 text-zinc-950" />
                <span>New Research</span>
              </a>

              {/* User Avatar Menu */}
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white/[0.06] border border-transparent hover:border-white/[0.08] transition-all cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-full bg-[#161822] border border-white/[0.12] text-zinc-300 text-xs font-mono font-medium flex items-center justify-center">
                    {user.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline text-xs text-zinc-300 font-medium max-w-[120px] truncate">
                    {user.username}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[#14151a] border border-white/[0.1] shadow-2xl p-1.5 space-y-1 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 z-50">
                    <div className="px-3 py-2 border-b border-white/[0.06]">
                      <p className="text-xs font-semibold text-zinc-100 truncate">{user.username}</p>
                      <p className="text-[11px] text-zinc-400 font-mono truncate">{user.email}</p>
                    </div>

                    <a
                      href="/settings"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Account Settings</span>
                    </a>

                    <a
                      href="/vault"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
                    >
                      <FolderArchive className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Knowledge Vault</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => {
                        setDropdownOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
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
              <a
                href="/login"
                className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-colors"
              >
                Sign In
              </a>
              <a
                href="/register"
                className="bg-zinc-200 hover:bg-white text-zinc-950 font-semibold text-xs px-4 py-2 rounded-lg shadow-sm transition-all"
              >
                Get Started
              </a>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
