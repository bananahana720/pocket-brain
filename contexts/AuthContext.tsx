import React, { createContext, useContext, useMemo } from 'react';
import {
  ClerkProvider,
  useAuth as useClerkAuth,
  useClerk,
  useUser,
} from '@clerk/clerk-react';
import { configureApiClient } from '../services/apiClient';

interface AuthContextValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  userEmail: string | null;
  getToken: () => Promise<string | null>;
  openSignIn: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  userEmail: null,
  getToken: async () => null,
  openSignIn: () => {},
  signOut: async () => {},
});

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const DEV_AUTH_USER_ID = (import.meta.env.VITE_DEV_AUTH_USER_ID as string | undefined)?.trim();
const DEV_AUTH_STORAGE_KEY = 'pb_dev_auth_user_id';

function resolveDevAuthUserId(): string | null {
  if (DEV_AUTH_USER_ID) return DEV_AUTH_USER_ID;
  if (typeof window === 'undefined') return null;
  const fromStorage = window.localStorage.getItem(DEV_AUTH_STORAGE_KEY)?.trim();
  return fromStorage || null;
}

function AnonymousAuthProvider({ children }: { children: React.ReactNode }) {
  const devAuthUserId = resolveDevAuthUserId();
  const value = useMemo<AuthContextValue>(
    () => {
      if (devAuthUserId) {
        return {
          isLoaded: true,
          isSignedIn: true,
          userId: devAuthUserId,
          userEmail: null,
          getToken: async () => null,
          openSignIn: () => {},
          signOut: async () => {},
        };
      }

      return {
        isLoaded: true,
        isSignedIn: false,
        userId: null,
        userEmail: null,
        getToken: async () => null,
        openSignIn: () => {},
        signOut: async () => {},
      };
    },
    [devAuthUserId]
  );

  configureApiClient(value.getToken);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkBridge({ children }: { children: React.ReactNode }) {
  const auth = useClerkAuth();
  const { user } = useUser();
  const clerk = useClerk();

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoaded: auth.isLoaded,
      isSignedIn: !!auth.isSignedIn,
      userId: auth.userId || null,
      userEmail: user?.primaryEmailAddress?.emailAddress || null,
      getToken: async () => {
        if (!auth.isSignedIn) return null;
        return auth.getToken();
      },
      openSignIn: () => {
        void clerk.openSignIn();
      },
      signOut: async () => {
        await clerk.signOut();
      },
    }),
    [auth, clerk, user]
  );

  configureApiClient(value.getToken);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) {
    return <AnonymousAuthProvider>{children}</AnonymousAuthProvider>;
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}
