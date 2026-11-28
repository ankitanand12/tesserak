import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { clearSwrCache } from '../utils/swrCache';
import type { AccountType } from '../types/user';

export interface AuthSessionUser {
  email: string;
  firstName: string;
  lastName: string;
  accountType?: AccountType;
  organization?: string;
  avatarUrl?: string;
  authProvider: 'auth0' | 'auth0-demo-sso' | 'email' | 'local';
}

export interface Auth0LoginOptions {
  connection?: string;
  screen_hint?: 'signup' | 'login';
  login_hint?: string;
}

export interface LocalLoginOptions {
  token?: string;
  profile?: Partial<AuthSessionUser>;
}

interface TesserakAuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  userEmail: string | null;
  sessionUser: AuthSessionUser | null;
  isAuth0Configured: boolean;
  authMode: 'auth0' | 'local-fallback';
  authError: string | null;
  loginWithLocal: (email: string, options?: LocalLoginOptions) => void;
  loginWithAuth0: (options?: Auth0LoginOptions) => Promise<void>;
  simulateAuth0Sso: (email: string, organization?: string) => void;
  logout: () => void;
  getAccessToken: () => Promise<string | null>;
}

const AUTH0_DOMAIN = (process.env.REACT_APP_AUTH0_DOMAIN || '').trim();
const AUTH0_CLIENT_ID = (process.env.REACT_APP_AUTH0_CLIENT_ID || '').trim();
const AUTH0_AUDIENCE = (process.env.REACT_APP_AUTH0_AUDIENCE || '').trim();

const isRealAuth0EnvConfigured =
  Boolean(AUTH0_DOMAIN && AUTH0_CLIENT_ID) &&
  !AUTH0_DOMAIN.includes('your-tenant') &&
  !AUTH0_CLIENT_ID.includes('your-auth0');

const SESSION_TOKEN_KEY = 'tesserakSessionToken';

const TesserakAuthContext = createContext<TesserakAuthContextValue | null>(null);

const readStoredUserProfile = (email: string | null): AuthSessionUser | null => {
  if (!email) return null;
  try {
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    const profile = users[email] || {};
    const providerFlag = localStorage.getItem('authProvider');
    const authProvider: AuthSessionUser['authProvider'] =
      providerFlag === 'auth0' || providerFlag === 'auth0-demo-sso' || providerFlag === 'email'
        ? providerFlag
        : 'local';

    return {
      email,
      firstName: profile.firstName || email.split('@')[0] || 'Platform',
      lastName: profile.lastName || 'User',
      accountType: profile.accountType === 'organization' ? 'organization' : 'individual',
      organization: profile.organization || 'Tesserak Platform',
      avatarUrl: profile.avatarUrl,
      authProvider,
    };
  } catch {
    return {
      email,
      firstName: email.split('@')[0] || 'Platform',
      lastName: 'User',
      accountType: 'individual',
      authProvider: 'local',
    };
  }
};

const persistLocalProfile = (
  email: string,
  provider: AuthSessionUser['authProvider'],
  options?: LocalLoginOptions
) => {
  localStorage.setItem('currentUser', email);
  localStorage.setItem('authProvider', provider);
  if (options?.token) {
    localStorage.setItem(SESSION_TOKEN_KEY, options.token);
  }
  const users = JSON.parse(localStorage.getItem('users') || '{}');
  users[email] = {
    ...users[email],
    ...options?.profile,
    email,
  };
  localStorage.setItem('users', JSON.stringify(users));
};

const installBackendAuthInterceptor = (
  resolveToken: () => Promise<string | null>,
  resolveUserEmail: () => string | null
): (() => void) => {
  const origFetch = window.fetch.bind(window);
  let inflightTokenPromise: Promise<string | null> | null = null;

  const getSingleFlightToken = async (): Promise<string | null> => {
    if (!inflightTokenPromise) {
      inflightTokenPromise = resolveToken().finally(() => {
        inflightTokenPromise = null;
      });
    }
    return inflightTokenPromise;
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
        ? input.url
        : input.toString();

    if (url.startsWith('http://localhost:8000') && !url.includes('/api/auth/')) {
      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined)
      );
      const activeEmail = resolveUserEmail();
      if (activeEmail) {
        headers.set('x-user-email', activeEmail);
      }
      try {
        const token = await getSingleFlightToken();
        if (token && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
      } catch (err) {
        console.warn('Auth token retrieval failed for backend request:', err);
      }
      return origFetch(input, { ...init, headers });
    }
    return origFetch(input, init);
  };

  return () => {
    window.fetch = origFetch;
  };
};

const Auth0SdkBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    isLoading,
    isAuthenticated: auth0Authed,
    user: auth0User,
    error,
    loginWithRedirect,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();

  const [localEmail, setLocalEmail] = useState<string | null>(() =>
    localStorage.getItem('currentUser')
  );
  const [localToken, setLocalToken] = useState<string | null>(() =>
    localStorage.getItem(SESSION_TOKEN_KEY)
  );
  const [authProvider, setAuthProvider] = useState<AuthSessionUser['authProvider']>(() => {
    const p = localStorage.getItem('authProvider');
    return p === 'auth0' || p === 'auth0-demo-sso' || p === 'email' ? p : 'local';
  });
  const [profileTick, setProfileTick] = useState(0);

  useEffect(() => {
    const handleProfileUpdate = () => setProfileTick((t) => t + 1);
    window.addEventListener('tesserak-profile-updated', handleProfileUpdate);
    return () => window.removeEventListener('tesserak-profile-updated', handleProfileUpdate);
  }, []);

  const lastSyncedSigRef = useRef<string>('');

  useLayoutEffect(() => {
    if (auth0Authed && auth0User) {
      const email = (auth0User.email || auth0User.sub || 'sso-user@tesserak.dev').toLowerCase();
      const ssoPicture = (auth0User.picture || '').trim();
      const firstName = auth0User.given_name || auth0User.name?.split(' ')[0] || 'SSO';
      const lastName = auth0User.family_name || auth0User.name?.split(' ').slice(1).join(' ') || 'User';
      const orgId = auth0User.org_id || '';
      const sig = `${email}|${ssoPicture}|${firstName}|${lastName}|${orgId}`;
      if (lastSyncedSigRef.current === sig) {
        return;
      }
      lastSyncedSigRef.current = sig;

      localStorage.setItem('currentUser', email);
      localStorage.setItem('authProvider', 'auth0');
      localStorage.removeItem(SESSION_TOKEN_KEY);
      const users = JSON.parse(localStorage.getItem('users') || '{}');
      users[email] = {
        ...users[email],
        email,
        firstName,
        lastName,
        accountType: orgId ? 'organization' : users[email]?.accountType || 'individual',
        organization: orgId || users[email]?.organization || 'Auth0 Enterprise SSO',
        avatarUrl: users[email]?.avatarUrl || ssoPicture,
      };
      localStorage.setItem('users', JSON.stringify(users));
      setAuthProvider('auth0');
      setLocalToken(null);
      setLocalEmail(email);
      setProfileTick((t) => t + 1);
    } else {
      lastSyncedSigRef.current = '';
    }
  }, [
    auth0Authed,
    auth0User?.email,
    auth0User?.sub,
    auth0User?.picture,
    auth0User?.given_name,
    auth0User?.family_name,
    auth0User?.name,
    auth0User?.org_id,
  ]);

  const hasEmailSession = Boolean(localEmail && localToken);
  const effectiveEmail = auth0Authed
    ? (auth0User?.email || auth0User?.sub || localEmail || '').toLowerCase() || null
    : hasEmailSession
    ? localEmail
    : null;

  const auth0AuthedRef = useRef(auth0Authed);
  auth0AuthedRef.current = auth0Authed;
  const localTokenRef = useRef(localToken);
  localTokenRef.current = localToken;
  const effectiveEmailRef = useRef(effectiveEmail);
  effectiveEmailRef.current = effectiveEmail;
  const getTokenRef = useRef(getAccessTokenSilently);
  getTokenRef.current = getAccessTokenSilently;

  const hasBackendAuth = auth0Authed || Boolean(localToken);

  // Attach Auth0 RS256 JWT or signed email session token + normalized x-user-email to FastAPI requests
  useLayoutEffect(() => {
    if (!hasBackendAuth) return;
    return installBackendAuthInterceptor(
      async () => {
        if (auth0AuthedRef.current) {
          const token = await getTokenRef.current({
            authorizationParams: AUTH0_AUDIENCE ? { audience: AUTH0_AUDIENCE } : undefined,
          });
          return token ?? null;
        }
        return localTokenRef.current;
      },
      () => effectiveEmailRef.current
    );
  }, [hasBackendAuth]);

  // Persist/hydrate Auth0 SSO user profile with PostgreSQL once authenticated
  useEffect(() => {
    if (!auth0Authed || !auth0User || !effectiveEmail) return;
    let active = true;
    const syncProfile = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/profile', {
          headers: { 'x-user-email': effectiveEmail },
        });
        if (!active || !res.ok) return;
        const dbProfile = await res.json();
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        const existing = users[effectiveEmail] || {};
        const ssoPicture = (auth0User.picture || '').trim();
        const resolvedAvatar =
          (dbProfile?.avatarUrl || '').trim() ||
          ssoPicture ||
          (existing.avatarUrl || '').trim();

        if (dbProfile && (dbProfile.firstName || dbProfile.avatarUrl)) {
          users[effectiveEmail] = {
            ...existing,
            ...dbProfile,
            avatarUrl: resolvedAvatar,
          };
          localStorage.setItem('users', JSON.stringify(users));
          setProfileTick((t) => t + 1);
          // Backfill DB if Auth0/Google provided a picture but PostgreSQL had none yet
          if (!(dbProfile.avatarUrl || '').trim() && ssoPicture) {
            await fetch('http://localhost:8000/api/profile', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'x-user-email': effectiveEmail,
              },
              body: JSON.stringify({ avatarUrl: ssoPicture }),
            });
          }
          return;
        }
        await fetch('http://localhost:8000/api/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-user-email': effectiveEmail,
          },
          body: JSON.stringify({
            firstName: auth0User.given_name || auth0User.name?.split(' ')[0] || 'SSO',
            lastName: auth0User.family_name || auth0User.name?.split(' ').slice(1).join(' ') || 'User',
            accountType: auth0User.org_id ? 'organization' : 'individual',
            organization: auth0User.org_id || 'Auth0 Enterprise SSO',
            authProvider: 'auth0',
            avatarUrl: resolvedAvatar,
          }),
        });
      } catch {
        // Non-fatal profile sync fallback
      }
    };
    syncProfile();
    return () => {
      active = false;
    };
  }, [auth0Authed, auth0User, effectiveEmail]);

  const sessionUser = useMemo(() => {
    const base = readStoredUserProfile(effectiveEmail);
    if (!base) return null;
    return {
      ...base,
      avatarUrl: base.avatarUrl || auth0User?.picture || '',
      authProvider,
    };
  }, [effectiveEmail, authProvider, auth0User?.picture, profileTick]);

  const value: TesserakAuthContextValue = {
    isAuthenticated: Boolean(auth0Authed || hasEmailSession),
    isLoading,
    userEmail: effectiveEmail,
    sessionUser,
    isAuth0Configured: true,
    authMode: 'auth0',
    authError: error?.message || null,
    loginWithLocal: (email: string, options?: LocalLoginOptions) => {
      const provider: AuthSessionUser['authProvider'] = options?.token ? 'email' : 'local';
      persistLocalProfile(email, provider, options);
      setAuthProvider(provider);
      setLocalToken(options?.token || null);
      setLocalEmail(email);
      setProfileTick((t) => t + 1);
    },
    loginWithAuth0: async (options?: Auth0LoginOptions) => {
      await loginWithRedirect({
        authorizationParams: {
          ...(options?.connection ? { connection: options.connection } : {}),
          ...(options?.screen_hint ? { screen_hint: options.screen_hint } : {}),
          ...(options?.login_hint ? { login_hint: options.login_hint } : {}),
        },
      });
    },
    simulateAuth0Sso: (email: string, organization = 'Enterprise SSO') => {
      persistLocalProfile(email, 'auth0-demo-sso', {
        profile: {
          firstName: email.split('@')[0],
          lastName: 'SSO',
          accountType: 'organization',
          organization,
        },
      });
      setAuthProvider('auth0-demo-sso');
      setLocalEmail(email);
    },
    logout: () => {
      const wasAuth0 = auth0Authed;
      clearSwrCache();
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authProvider');
      localStorage.removeItem(SESSION_TOKEN_KEY);
      setAuthProvider('local');
      setLocalToken(null);
      setLocalEmail(null);
      if (wasAuth0) {
        auth0Logout({ logoutParams: { returnTo: window.location.origin } });
      }
    },
    getAccessToken: async () => {
      if (auth0Authed) {
        try {
          const token = await getAccessTokenSilently();
          return token ?? null;
        } catch {
          return null;
        }
      }
      return localToken;
    },
  };

  return (
    <TesserakAuthContext.Provider value={value}>
      {children}
    </TesserakAuthContext.Provider>
  );
};

const FallbackAuthBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [localEmail, setLocalEmail] = useState<string | null>(() =>
    localStorage.getItem('currentUser')
  );
  const [localToken, setLocalToken] = useState<string | null>(() =>
    localStorage.getItem(SESSION_TOKEN_KEY)
  );
  const [authProvider, setAuthProvider] = useState<AuthSessionUser['authProvider']>(() => {
    const p = localStorage.getItem('authProvider');
    return p === 'auth0' || p === 'auth0-demo-sso' || p === 'email' ? p : 'local';
  });
  const [profileTick, setProfileTick] = useState(0);

  useEffect(() => {
    const handleProfileUpdate = () => setProfileTick((t) => t + 1);
    window.addEventListener('tesserak-profile-updated', handleProfileUpdate);
    return () => window.removeEventListener('tesserak-profile-updated', handleProfileUpdate);
  }, []);

  useLayoutEffect(() => {
    if (!localToken) return;
    return installBackendAuthInterceptor(
      async () => localToken,
      () => localEmail
    );
  }, [localToken, localEmail]);

  const sessionUser = useMemo(() => {
    const base = readStoredUserProfile(localEmail);
    return base ? { ...base, authProvider } : null;
  }, [localEmail, authProvider, profileTick]);

  const value: TesserakAuthContextValue = {
    isAuthenticated: Boolean(localEmail),
    isLoading: false,
    userEmail: localEmail,
    sessionUser,
    isAuth0Configured: false,
    authMode: 'local-fallback',
    authError: null,
    loginWithLocal: (email: string, options?: LocalLoginOptions) => {
      const provider: AuthSessionUser['authProvider'] = options?.token ? 'email' : 'local';
      persistLocalProfile(email, provider, options);
      setAuthProvider(provider);
      setLocalToken(options?.token || null);
      setLocalEmail(email);
      setProfileTick((t) => t + 1);
    },
    loginWithAuth0: async () => {
      throw new Error('AUTH0_NOT_CONFIGURED');
    },
    simulateAuth0Sso: (email: string, organization = 'Auth0 Enterprise SSO (Dev Mode)') => {
      persistLocalProfile(email, 'auth0-demo-sso', {
        profile: {
          firstName: email.split('@')[0],
          lastName: 'SSO',
          accountType: 'organization',
          organization,
        },
      });
      setAuthProvider('auth0-demo-sso');
      setLocalEmail(email);
    },
    logout: () => {
      clearSwrCache();
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authProvider');
      localStorage.removeItem(SESSION_TOKEN_KEY);
      setAuthProvider('local');
      setLocalToken(null);
      setLocalEmail(null);
    },
    getAccessToken: async () => localToken,
  };

  return (
    <TesserakAuthContext.Provider value={value}>
      {children}
    </TesserakAuthContext.Provider>
  );
};

export const TesserakAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const domain = (process.env.REACT_APP_AUTH0_DOMAIN || AUTH0_DOMAIN).trim();
  const clientId = (process.env.REACT_APP_AUTH0_CLIENT_ID || AUTH0_CLIENT_ID).trim();
  const audience = (process.env.REACT_APP_AUTH0_AUDIENCE || AUTH0_AUDIENCE).trim();
  const configured =
    Boolean(domain && clientId) &&
    !domain.includes('your-tenant') &&
    !clientId.includes('your-auth0');

  if (configured || isRealAuth0EnvConfigured) {
    return (
      <Auth0Provider
        domain={domain}
        clientId={clientId}
        authorizationParams={{
          redirect_uri: window.location.origin,
          scope: 'openid profile email offline_access',
          ...(audience ? { audience } : {}),
        }}
        useRefreshTokens={true}
        useRefreshTokensFallback={true}
        cacheLocation="localstorage"
      >
        <Auth0SdkBridge>{children}</Auth0SdkBridge>
      </Auth0Provider>
    );
  }

  return <FallbackAuthBridge>{children}</FallbackAuthBridge>;
};

export const useTesserakAuth = (): TesserakAuthContextValue => {
  const ctx = useContext(TesserakAuthContext);
  if (!ctx) {
    throw new Error('useTesserakAuth must be used inside TesserakAuthProvider');
  }
  return ctx;
};
