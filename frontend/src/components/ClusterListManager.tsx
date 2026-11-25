import React, { useCallback, useEffect, useState } from 'react';
import { useTesserakAuth } from '../auth/AuthContext';
import { Cluster } from '../types/cluster';
import { fetchWithSwr, readSwrCache } from '../utils/swrCache';

export interface ClusterListHelpers {
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refreshClusters: (force?: boolean) => Promise<void>;
}

interface ClusterListManagerProps {
  children: (clusters: Cluster[], helpers: ClusterListHelpers) => React.ReactNode;
}

const ClusterListManager: React.FC<ClusterListManagerProps> = ({ children }) => {
  const { userEmail: authEmail } = useTesserakAuth();
  const userEmail = authEmail || localStorage.getItem('currentUser') || '';

  const [clusters, setClusters] = useState<Cluster[]>(
    () => readSwrCache<Cluster[]>(userEmail, 'clusters') ?? []
  );
  const [loading, setLoading] = useState<boolean>(
    () => readSwrCache<Cluster[]>(userEmail, 'clusters') === undefined
  );
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchClusters = useCallback(
    async (force: boolean = false) => {
      const cached = readSwrCache<Cluster[]>(userEmail, 'clusters');
      if (cached !== undefined) {
        setClusters(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }

      try {
        const list = await fetchWithSwr<Cluster[]>(
          userEmail,
          'clusters',
          async () => {
            const url = force
              ? 'http://localhost:8000/clusters?refresh=true'
              : 'http://localhost:8000/clusters';
            const response = await fetch(url, {
              headers: {
                'x-user-email': userEmail,
                Accept: 'application/json',
              },
            });

            if (!response.ok) {
              if (response.status === 400) {
                return [];
              }
              throw new Error('Failed to fetch clusters');
            }

            const data = await response.json();
            return Array.isArray(data) ? data : [];
          },
          { force, dedupeWindowMs: 4000 }
        );
        setClusters(list);
        setError(null);
        setLastUpdated(new Date());
      } catch (err: any) {
        if (readSwrCache<Cluster[]>(userEmail, 'clusters') === undefined) {
          setError(err?.message || 'Unable to reach EKS cluster service');
        }
      } finally {
        setLoading(false);
      }
    },
    [userEmail]
  );

  // Fetch clusters on mount (background revalidation if cached) & every 60s
  useEffect(() => {
    fetchClusters(false);
    const interval = setInterval(() => fetchClusters(true), 60000);
    return () => clearInterval(interval);
  }, [fetchClusters]);

  return (
    <>
      {children(clusters, {
        loading,
        error,
        lastUpdated,
        refreshClusters: fetchClusters,
      })}
    </>
  );
};

export default ClusterListManager;
