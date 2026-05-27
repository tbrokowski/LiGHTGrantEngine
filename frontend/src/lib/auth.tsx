'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth } from '@/lib/api';

export interface ModulePermissions {
  can_view_grants: boolean;
  can_view_archive: boolean;
  can_view_partners: boolean;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  institution_id: string | null;
  institution_role: string | null;
  email_verified: boolean;
  onboarding_complete: boolean;
  ai_usage_cents: number;
  ai_usage_limit_cents: number;
  google_access_token?: string | null;
  module_permissions: ModulePermissions;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchUser() {
    try {
      const res = await auth.me();
      setUser(res.data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('access_token')) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function isInstitutionAdmin(user: AuthUser | null): boolean {
  return user?.role === 'admin' || user?.institution_role === 'admin';
}

export function hasModulePermission(user: AuthUser | null, key: keyof ModulePermissions): boolean {
  if (!user) return false;
  if (isInstitutionAdmin(user)) return true;
  return user.module_permissions?.[key] ?? false;
}
