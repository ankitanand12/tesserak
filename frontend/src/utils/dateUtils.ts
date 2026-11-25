/**
 * Format an ISO timestamp as a concise relative string (e.g. "5m ago") with safe fallback.
 */
export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'Just now';
  const normalized = iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return iso;

  const diffSec = Math.round((parsed.getTime() - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 45) return 'Just now';

  const rtf =
    typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat !== 'undefined'
      ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
      : null;

  if (absSec < 3600) {
    const mins = Math.round(diffSec / 60);
    return rtf ? rtf.format(mins, 'minute') : `${Math.abs(mins)}m ago`;
  }
  if (absSec < 86400) {
    const hours = Math.round(diffSec / 3600);
    return rtf ? rtf.format(hours, 'hour') : `${Math.abs(hours)}h ago`;
  }
  const days = Math.round(diffSec / 86400);
  if (Math.abs(days) <= 14) {
    return rtf ? rtf.format(days, 'day') : `${Math.abs(days)}d ago`;
  }
  return parsed.toLocaleDateString();
}
