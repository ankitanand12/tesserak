interface CacheEntry<T = any> {
  data: T;
  fetchedAt: number;
}

const cacheStore = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<any>>();

const DEFAULT_REVALIDATE_AFTER_MS = 3000;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

export const makeSwrKey = (userEmail: string, key: string): string =>
  `${(userEmail || 'anon').trim().toLowerCase()}::${key}`;

export function readSwrCache<T>(
  userEmail: string,
  key: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): T | undefined {
  const fullKey = makeSwrKey(userEmail, key);
  const entry = cacheStore.get(fullKey);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > maxAgeMs) {
    cacheStore.delete(fullKey);
    return undefined;
  }
  return entry.data as T;
}

export function writeSwrCache<T>(userEmail: string, key: string, data: T): void {
  const fullKey = makeSwrKey(userEmail, key);
  cacheStore.set(fullKey, { data, fetchedAt: Date.now() });
}

export function clearSwrCache(): void {
  cacheStore.clear();
  inflightRequests.clear();
}

export function invalidateSwrCache(userEmail?: string, keyPrefix?: string): void {
  if (!userEmail && !keyPrefix) {
    cacheStore.clear();
    inflightRequests.clear();
    return;
  }
  const emailPrefix = userEmail ? `${userEmail.trim().toLowerCase()}::` : '';
  for (const store of [cacheStore, inflightRequests]) {
    for (const fullKey of Array.from(store.keys())) {
      if (emailPrefix && !fullKey.startsWith(emailPrefix)) continue;
      const rawKey = emailPrefix ? fullKey.slice(emailPrefix.length) : fullKey.split('::')[1] || fullKey;
      if (!keyPrefix || rawKey.startsWith(keyPrefix)) {
        store.delete(fullKey);
      }
    }
  }
}

export async function fetchWithSwr<T>(
  userEmail: string,
  key: string,
  fetcher: () => Promise<T>,
  options?: { force?: boolean; dedupeWindowMs?: number }
): Promise<T> {
  const fullKey = makeSwrKey(userEmail, key);
  const force = Boolean(options?.force);
  const dedupeWindowMs = options?.dedupeWindowMs ?? DEFAULT_REVALIDATE_AFTER_MS;

  if (!force) {
    const existing = cacheStore.get(fullKey);
    if (existing && Date.now() - existing.fetchedAt < dedupeWindowMs) {
      return existing.data as T;
    }
    const inflight = inflightRequests.get(fullKey);
    if (inflight) {
      return inflight as Promise<T>;
    }
  }

  const reqPromise = fetcher()
    .then((result) => {
      cacheStore.set(fullKey, { data: result, fetchedAt: Date.now() });
      return result;
    })
    .finally(() => {
      inflightRequests.delete(fullKey);
    });

  inflightRequests.set(fullKey, reqPromise);
  return reqPromise;
}
