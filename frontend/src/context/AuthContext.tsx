"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/config";

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  created_at?: string;
  stats?: {
    sessions: number;
    vault_docs: number;
  };
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  changePassword: (currentPass: string, newPass: string) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
}

function apiErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object" && "msg" in item && typeof item.msg === "string") {
        return [item.msg];
      }
      return [];
    }).filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  return fallback;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: () => {},
  changePassword: async () => ({ success: false }),
  refreshUser: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const authRequestId = useRef(0);

  const validateStoredToken = useCallback(async (candidate: string) => {
    const requestId = ++authRequestId.current;
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${candidate}` },
      });
      if (!res.ok) throw new Error("Invalid token");
      const userData = await res.json();
      if (requestId === authRequestId.current) {
        setToken(candidate);
        setUser(userData);
      }
    } catch {
      if (requestId === authRequestId.current) {
        localStorage.removeItem("ada_auth_token");
        setToken(null);
        setUser(null);
      }
    } finally {
      if (requestId === authRequestId.current) setLoading(false);
    }
  }, []);

  // Rehydrate auth state on mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedToken = localStorage.getItem("ada_auth_token");
      if (savedToken) void validateStoredToken(savedToken);
      else setLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [validateStoredToken]);

  // Keep authentication state aligned when a user signs in or out in another tab.
  useEffect(() => {
    const syncAuthAcrossTabs = (event: StorageEvent) => {
      if (event.key !== "ada_auth_token") return;
      const nextToken = event.newValue;
      if (!nextToken) {
        authRequestId.current += 1;
        setToken(null);
        setUser(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setToken(null);
      setUser(null);
      void validateStoredToken(nextToken);
    };

    window.addEventListener("storage", syncAuthAcrossTabs);
    return () => window.removeEventListener("storage", syncAuthAcrossTabs);
  }, [validateStoredToken]);

  const login = async (loginId: string, pass: string) => {
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: loginId, password: pass })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: apiErrorMessage(data.detail, "Login failed") };
      }
      authRequestId.current += 1;
      localStorage.setItem("ada_auth_token", data.token);
      setToken(data.token);
      setUser(data.user);
      setLoading(false);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : "Network error" };
    }
  };

  const register = async (email: string, username: string, pass: string) => {
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password: pass })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: apiErrorMessage(data.detail, "Registration failed") };
      }
      authRequestId.current += 1;
      localStorage.setItem("ada_auth_token", data.token);
      setToken(data.token);
      setUser(data.user);
      setLoading(false);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : "Network error" };
    }
  };

  const logout = () => {
    authRequestId.current += 1;
    localStorage.removeItem("ada_auth_token");
    setToken(null);
    setUser(null);
    setLoading(false);
    router.replace("/");
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!token) return { success: false, error: "Not authenticated" };
    try {
      const res = await fetch(`${API_URL}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: apiErrorMessage(data.detail, "Password change failed") };
      }
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : "Network error" };
    }
  };

  const refreshUser = async () => {
    if (!token) return;
    const currentToken = token;
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        // `token` here is the callback's captured value, so comparing it to
        // `currentToken` never detects a cross-tab sign-out/token replacement.
        // Read the current persisted token after the request finishes instead.
        if (localStorage.getItem("ada_auth_token") === currentToken) setUser(data);
      }
    } catch (err) {
      console.warn("refreshUser failed:", err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, changePassword, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
