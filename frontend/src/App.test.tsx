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

test('switching between Sign In and Create Account clears form inputs', () => {
  render(<App />);

  const signInEmail = screen.getByLabelText(/Email Address/i) as HTMLInputElement;
  const signInPassword = screen.getByLabelText(/^Password/i) as HTMLInputElement;
  fireEvent.change(signInEmail, { target: { value: 'leak@example.com' } });
  fireEvent.change(signInPassword, { target: { value: 'secret123' } });
  expect(signInEmail.value).toBe('leak@example.com');

  fireEvent.click(screen.getByRole('tab', { name: /Create Account/i }));
  expect((screen.getByLabelText(/Email Address/i) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(/^Password/i) as HTMLInputElement).value).toBe('');

  fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Manoj' } });
  fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'manoj@example.com' } });
  fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'pass1234' } });

  fireEvent.click(screen.getByRole('tab', { name: /^Sign In$/i }));
  expect((screen.getByLabelText(/Email Address/i) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(/^Password/i) as HTMLInputElement).value).toBe('');
});

test('completes Individual signup via OTP verification and transitions into workspace with Auth0 connected', async () => {
  const origEnv = { ...process.env };
  process.env.REACT_APP_AUTH0_DOMAIN = 'tesserak.us.auth0.com';
  process.env.REACT_APP_AUTH0_CLIENT_ID = 'client-123';

  try {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/email/register')) {
        return {
          ok: true,
          json: async () => ({
            verificationRequired: true,
            email: 'manoj@example.com',
            accountType: 'individual',
            organization: 'Individual Workspace',
            deliveryMode: 'dev-preview',
            devOtp: '654321',
            message: 'Verification code generated for manoj@example.com.',
          }),
        } as Response;
      }
      if (url.endsWith('/api/auth/email/verify-otp')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.otp !== '654321') {
          return { ok: false, json: async () => ({ detail: 'Invalid OTP' }) } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            verified: true,
            token: 'tesserak.ind-payload.sig',
            user: {
              email: 'manoj@example.com',
              firstName: 'Manoj',
              lastName: 'Kumar',
              accountType: 'individual',
              organization: 'Individual Workspace',
              authProvider: 'email',
            },
            message: 'Individual account verified and created for manoj@example.com.',
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Create Account/i }));
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Manoj' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'Kumar' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'manoj@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Individual Account/i }));

    await waitFor(() => {
      expect(screen.getByText(/Verify Email Address/i)).toBeInTheDocument();
      expect(screen.getByText('654321')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Verification Code/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify Email & Create Account/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Individual Email Account').length).toBeGreaterThan(0);
      expect(screen.getByText('manoj@example.com')).toBeInTheDocument();
      expect(
        screen.getByText(/Individual account verified and created for manoj@example\.com\./i)
      ).toBeInTheDocument();
    });
  } finally {
    process.env = origEnv;
  }
});

test('completes Organization signup OTP verification and Email Sign In with Auth0 connected', async () => {
  const origEnv = { ...process.env };
  process.env.REACT_APP_AUTH0_DOMAIN = 'tesserak.us.auth0.com';
  process.env.REACT_APP_AUTH0_CLIENT_ID = 'client-123';

  try {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/auth/email/register')) {
        return {
          ok: true,
          json: async () => ({
            verificationRequired: true,
            email: 'lead@acme.io',
            accountType: 'organization',
            organization: 'Acme Cloud',
            deliveryMode: 'dev-preview',
            devOtp: '112233',
            message: 'Verification code generated for lead@acme.io.',
          }),
        } as Response;
      }
      if (url.endsWith('/api/auth/email/verify-otp')) {
        return {
          ok: true,
          json: async () => ({
            verified: true,
            token: 'tesserak.org-payload.sig',
            user: {
              email: 'lead@acme.io',
              firstName: 'Priya',
              lastName: 'Nair',
              accountType: 'organization',
              organization: 'Acme Cloud',
              authProvider: 'email',
            },
            message: 'Organization account verified and created for Acme Cloud.',
          }),
        } as Response;
      }
      if (url.endsWith('/api/auth/email/login')) {
        return {
          ok: true,
          json: async () => ({
            token: 'tesserak.org-login.sig',
            user: {
              email: 'lead@acme.io',
              firstName: 'Priya',
              lastName: 'Nair',
              accountType: 'organization',
              organization: 'Acme Cloud',
              authProvider: 'email',
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;

    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Create Account/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Organization account$/i }));
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'Nair' } });
    fireEvent.change(screen.getByLabelText(/Organization Name/i), { target: { value: 'Acme Cloud' } });
    fireEvent.change(screen.getByLabelText(/Work Email/i), { target: { value: 'lead@acme.io' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'orgpass123' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Organization Account/i }));

    await waitFor(() => {
      expect(screen.getByText(/Organization · Acme Cloud/i)).toBeInTheDocument();
      expect(screen.getByText('112233')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Use Code/i }));
    fireEvent.click(screen.getByRole('button', { name: /Verify Email & Create Account/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Org Account · Acme Cloud').length).toBeGreaterThan(0);
      expect(
        screen.getByText(/Organization account verified and created for Acme Cloud\./i)
      ).toBeInTheDocument();
    });

    unmount();
    localStorage.clear();

    // Verify Sign In transitions into workspace as well
    render(<App />);
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'lead@acme.io' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'orgpass123' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In with Email/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Org Account · Acme Cloud').length).toBeGreaterThan(0);
      expect(screen.getByText(/Signed in as lead@acme\.io · Acme Cloud\./i)).toBeInTheDocument();
    });
  } finally {
    process.env = origEnv;
  }
});
