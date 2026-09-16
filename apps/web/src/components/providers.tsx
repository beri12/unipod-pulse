'use client';

import type { PublicUser } from '@unipods/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api/client';
import { authApi, tokenStore } from '@/lib/api';

interface AuthContextValue {
  user: PublicUser | null;
  /** True until the stored session has been checked on first load. */
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<PublicUser>;
  register: (name: string, email: string, password: string) => Promise<PublicUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <Providers>');
  return context;
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Auth and validation failures will not fix themselves.
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<PublicUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();

  const load = React.useCallback(async () => {
    if (!tokenStore.access && !tokenStore.refresh) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await authApi.me());
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAdmin: user?.role === 'ADMIN',
      async signIn(email, password) {
        const result = await authApi.login({ email, password });
        tokenStore.set(result);
        setUser(result.user);
        return result.user;
      },
      async register(name, email, password) {
        const result = await authApi.register({ name, email, password });
        tokenStore.set(result);
        setUser(result.user);
        return result.user;
      },
      async signOut() {
        await authApi.logout();
        setUser(null);
        router.push('/login');
      },
      refresh: load,
    }),
    [user, loading, load, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        <Toaster position="bottom-right" closeButton richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * Guards a page. Renders `fallback` while the session is being checked, and
 * redirects to sign-in (or away from admin-only pages) rather than flashing
 * content the person is not allowed to see.
 */
export function RequireAuth({
  children,
  adminOnly = false,
  fallback,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  fallback?: React.ReactNode;
}) {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (adminOnly && !isAdmin) {
      router.replace('/chat');
    }
  }, [loading, user, isAdmin, adminOnly, router, pathname]);

  if (loading || !user || (adminOnly && !isAdmin)) {
    return <>{fallback ?? null}</>;
  }
  return <>{children}</>;
}
