import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const mockUseAuth0 = jest.fn();

jest.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => mockUseAuth0(),
}));

jest.mock(
  'react-router-dom',
  () => ({
    BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Route: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: '/' }),
  }),
  { virtual: true }
);

beforeEach(() => {
  localStorage.clear();
  mockUseAuth0.mockReturnValue({
    isLoading: false,
    isAuthenticated: false,
    user: undefined,
    error: undefined,
    loginWithRedirect: jest.fn(),
    logout: jest.fn(),
    getAccessTokenSilently: jest.fn(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders Tesserak branding, Auth0 SSO, and Email Individual/Organization signup options', () => {
  render(<App />);
  const brandElement = screen.getByRole('heading', { name: /Tesserak/i });
  expect(brandElement).toBeInTheDocument();
  expect(screen.getByText(/EKS Cluster Manager/i)).toBeInTheDocument();

  // Both Auth0 SSO and Email Sign In are visible
  expect(screen.getByRole('button', { name: /Continue with Auth0 SSO/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Sign In with Email/i })).toBeInTheDocument();

  // Create Account supports Individual and Organization
  fireEvent.click(screen.getByRole('tab', { name: /Create Account/i }));
  expect(screen.getByRole('button', { name: /^Individual account$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Organization account$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Create Individual Account/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^Organization account$/i }));
  expect(screen.getByLabelText(/Organization Name/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Create Organization Account/i })).toBeInTheDocument();
});

test('preserves Auth0 Google SSO picture when PostgreSQL profile returns empty avatarUrl', async () => {
  const origEnv = { ...process.env };
  process.env.REACT_APP_AUTH0_DOMAIN = 'tesserak.us.auth0.com';
  process.env.REACT_APP_AUTH0_CLIENT_ID = 'client-123';

  mockUseAuth0.mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
    user: {
      email: 'ankit@tesserak.dev',
      given_name: 'Ankit',
      family_name: 'Anand',
      picture: 'https://lh3.googleusercontent.com/a/avatar-photo',
    },
    error: undefined,
    loginWithRedirect: jest.fn(),
    logout: jest.fn(),
    getAccessTokenSilently: jest.fn(async () => 'jwt-token'),
  });

  const putCalls: any[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/profile') && init?.method === 'PUT') {
      putCalls.push(JSON.parse(String(init.body || '{}')));
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }
    if (url.endsWith('/api/profile')) {
      return {
        ok: true,
        json: async () => ({
          email: 'ankit@tesserak.dev',
          firstName: 'Ankit',
          lastName: 'Anand',
          avatarUrl: '',
        }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as any;

  render(<App />);

  await waitFor(() => {
    const imgs = document.querySelectorAll('img');
    const avatar = Array.from(imgs).find(
      (img) => img.getAttribute('src') === 'https://lh3.googleusercontent.com/a/avatar-photo'
    );
    expect(avatar).toBeTruthy();
    expect(avatar?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  await waitFor(() => {
    expect(putCalls.some((p) => p.avatarUrl === 'https://lh3.googleusercontent.com/a/avatar-photo')).toBe(true);
  });

  process.env = origEnv;
});
