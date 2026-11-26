import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

jest.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => ({
    isLoading: false,
    isAuthenticated: false,
    user: undefined,
    error: undefined,
    loginWithRedirect: jest.fn(),
    logout: jest.fn(),
    getAccessTokenSilently: jest.fn(),
  }),
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
