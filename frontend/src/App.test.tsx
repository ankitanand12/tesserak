import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock(
  'react-router-dom',
  () => ({
    HashRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Route: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: '/' }),
  }),
  { virtual: true }
);

test('renders Tesserak branding on auth screen', () => {
  render(<App />);
  const brandElement = screen.getByRole('heading', { name: /Tesserak/i });
  expect(brandElement).toBeInTheDocument();
  expect(screen.getByText(/EKS Cluster Manager/i)).toBeInTheDocument();
});
