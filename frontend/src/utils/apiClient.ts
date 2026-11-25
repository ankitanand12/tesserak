export const API_BASE_URL = 'http://localhost:8000';

export async function buildAuthHeaders(
  userEmail: string,
  getAccessToken?: () => Promise<string | null>,
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'x-user-email': userEmail || 'demo@tesserak.dev',
    ...(extra || {}),
  };

  if (getAccessToken) {
    try {
      const token = await getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Fall back to x-user-email when no Auth0 session token is active
    }
  }

  return headers;
}
