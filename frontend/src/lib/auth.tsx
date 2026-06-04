'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth } from '@/lib/api';

export interface ModulePermissions {
  can_view_grants: boolean;
  can_view_archive: boolean;
  can_view_partners: boolean;
  can_view_finance: boolean;
}

const MODULE_PERMISSION_DEFAULTS: Partial<Record<keyof ModulePermissions, boolean>> = {
  can_view_archive: true,
  can_view_partners: true,
  can_view_finance: false,
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  institution_id: string | null;
  institution_role: string | null;
  institution_is_personal: boolean;
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

const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  contributor: 1,
  reviewer: 2,
  operations_manager: 3,
  grant_lead: 4,
  admin: 5,
};

export function roleEligibleForFinance(role: string): boolean {
  return (ROLE_RANK[role] ?? -1) >= ROLE_RANK.operations_manager;
}

/** Finance module: org admins, or ops_manager / grant_lead (unless explicitly revoked). */
export function canViewFinance(user: AuthUser | null): boolean {
  if (!user) return false;
  if (isInstitutionAdmin(user)) return true;
  if (!roleEligibleForFinance(user.role)) return false;
  if (user.module_permissions && 'can_view_finance' in user.module_permissions) {
    return Boolean(user.module_permissions.can_view_finance);
  }
  return true;
}

export function canViewFinanceForMember(member: {
  role: string;
  institution_role: string;
  module_permissions?: Record<string, boolean>;
}): boolean {
  if (member.institution_role === 'admin') return true;
  if (!roleEligibleForFinance(member.role)) return false;
  const perms = member.module_permissions ?? {};
  if ('can_view_finance' in perms) return Boolean(perms.can_view_finance);
  return true;
}

export function hasModulePermission(user: AuthUser | null, key: keyof ModulePermissions): boolean {
  if (!user) return false;
  if (key === 'can_view_finance') return canViewFinance(user);
  if (isInstitutionAdmin(user)) return true;
  if (user.module_permissions && key in user.module_permissions) {
    return Boolean(user.module_permissions[key]);
  }
  return MODULE_PERMISSION_DEFAULTS[key] ?? false;
}

/** Grant lead+ or org admin — can manage ledgers, approve fund requests, etc. */
export function canEditFinance(user: AuthUser | null): boolean {
  if (!user) return false;
  if (isInstitutionAdmin(user)) return true;
  return (ROLE_RANK[user.role] ?? -1) >= ROLE_RANK.grant_lead;
}
