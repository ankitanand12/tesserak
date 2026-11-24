import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';

export interface AuthSessionUser {
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  avatarUrl?: string;
  authProvider: 'auth0' | 'auth0-demo-sso' | 'local';
}

export interface Auth0LoginOptions {
  connection?: string;
  screen_hint?: 'signup' | 'login';
  login_hint?: string;
}

interface TesserakAuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  userEmail: string | null;
  sessionUser: AuthSessionUser | null;
  isAuth0Configured: boolean;
  authMode: 'auth0' | 'local-fallback';
  authError: string | null;
  loginWithLocal: (email: string) => void;
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

const TesserakAuthContext = createContext<TesserakAuthContextValue | null>(null);

const readStoredUserProfile = (email: string | null): AuthSessionUser | null => {
  if (!email) return null;
  try {
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    const profile = users[email] || {};
    const providerFlag = localStorage.getItem('authProvider');
    const authProvider: AuthSessionUser['authProvider'] =
      providerFlag === 'auth0' || providerFlag === 'auth0-demo-sso' ? providerFlag : 'local';

    return {
      email,
      firstName: profile.firstName || email.split('@')[0] || 'Platform',
      lastName: profile.lastName || 'User',
      organization: profile.organization || 'Tesserak Platform',
      avatarUrl: profile.avatarUrl,
      authProvider,
    };
  } catch {
    return {
      email,
      firstName: email.split('@')[0] || 'Platform',
      lastName: 'User',
      authProvider: 'local',
    };
  }
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
  const [authProvider, setAuthProvider] = useState<'auth0' | 'auth0-demo-sso' | 'local'>(() => {
    const p = localStorage.getItem('authProvider');
    return p === 'auth0' || p === 'auth0-demo-sso' ? p : 'local';
  });

  useEffect(() => {
    if (auth0Authed && auth0User?.email) {
      const email = auth0User.email;
      localStorage.setItem('currentUser', email);
      localStorage.setItem('authProvider', 'auth0');
      const users = JSON.parse(localStorage.getItem('users') || '{}');
      users[email] = {
        ...users[email],
        email,
        firstName: auth0User.given_name || auth0User.name?.split(' ')[0] || 'SSO',
        lastName: auth0User.family_name || auth0User.name?.split(' ').slice(1).join(' ') || 'User',
        organization: auth0User.org_id || users[email]?.organization || 'Auth0 Enterprise SSO',
        avatarUrl: auth0User.picture || users[email]?.avatarUrl,
      };
      localStorage.setItem('users', JSON.stringify(users));
      setAuthProvider('auth0');
      setLocalEmail(email);
    }
  }, [auth0Authed, auth0User]);

  const effectiveEmail = (auth0Authed && auth0User?.email) || localEmail;
  const sessionUser = useMemo(() => {
    const base = readStoredUserProfile(effectiveEmail);
    return base ? { ...base, authProvider } : null;
  }, [effectiveEmail, authProvider]);

  const value: TesserakAuthContextValue = {
    isAuthenticated: Boolean(auth0Authed || localEmail),
    isLoading,
    userEmail: effectiveEmail,
    sessionUser,
    isAuth0Configured: true,
    authMode: 'auth0',
    authError: error?.message || null,
    loginWithLocal: (email: string) => {
      localStorage.setItem('currentUser', email);
      localStorage.setItem('authProvider', 'local');
      setAuthProvider('local');
      setLocalEmail(email);
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
      localStorage.setItem('currentUser', email);
      localStorage.setItem('authProvider', 'auth0-demo-sso');
      const users = JSON.parse(localStorage.getItem('users') || '{}');
      users[email] = {
        ...users[email],
        email,
        firstName: users[email]?.firstName || email.split('@')[0],
        lastName: users[email]?.lastName || 'SSO',
        organization,
      };
      localStorage.setItem('users', JSON.stringify(users));
      setAuthProvider('auth0-demo-sso');
      setLocalEmail(email);
    },
    logout: () => {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authProvider');
      setAuthProvider('local');
      setLocalEmail(null);
      if (auth0Authed) {
        auth0Logout({ logoutParams: { returnTo: window.location.origin } });
      }
    },
    getAccessToken: async () => {
      if (!auth0Authed) return null;
      try {
        const token = await getAccessTokenSilently();
        return token ?? null;
      } catch {
        return null;
      }
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
  const [authProvider, setAuthProvider] = useState<'auth0' | 'auth0-demo-sso' | 'local'>(() => {
    const p = localStorage.getItem('authProvider');
    return p === 'auth0' || p === 'auth0-demo-sso' ? p : 'local';
  });

  const sessionUser = useMemo(() => {
    const base = readStoredUserProfile(localEmail);
    return base ? { ...base, authProvider } : null;
  }, [localEmail, authProvider]);

  const value: TesserakAuthContextValue = {
    isAuthenticated: Boolean(localEmail),
    isLoading: false,
    userEmail: localEmail,
    sessionUser,
    isAuth0Configured: false,
    authMode: 'local-fallback',
    authError: null,
    loginWithLocal: (email: string) => {
      localStorage.setItem('currentUser', email);
      localStorage.setItem('authProvider', 'local');
      setAuthProvider('local');
      setLocalEmail(email);
    },
    loginWithAuth0: async () => {
      throw new Error('AUTH0_NOT_CONFIGURED');
    },
    simulateAuth0Sso: (email: string, organization = 'Auth0 Enterprise SSO (Dev Mode)') => {
      localStorage.setItem('currentUser', email);
      localStorage.setItem('authProvider', 'auth0-demo-sso');
      const users = JSON.parse(localStorage.getItem('users') || '{}');
      users[email] = {
        ...users[email],
        email,
        firstName: users[email]?.firstName || email.split('@')[0],
        lastName: users[email]?.lastName || 'SSO',
        organization,
      };
      localStorage.setItem('users', JSON.stringify(users));
      setAuthProvider('auth0-demo-sso');
      setLocalEmail(email);
    },
    logout: () => {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authProvider');
      setAuthProvider('local');
      setLocalEmail(null);
    },
    getAccessToken: async () => null,
  };

  return (
    <TesserakAuthContext.Provider value={value}>
      {children}
    </TesserakAuthContext.Provider>
  );
};

export const TesserakAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (isRealAuth0EnvConfigured) {
    return (
      <Auth0Provider
        domain={AUTH0_DOMAIN}
        clientId={AUTH0_CLIENT_ID}
        authorizationParams={{
          redirect_uri: window.location.origin,
          ...(AUTH0_AUDIENCE ? { audience: AUTH0_AUDIENCE } : {}),
        }}
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
