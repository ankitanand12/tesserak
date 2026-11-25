import React, { useCallback, useEffect, useState } from 'react';
import { Cluster } from '../types/cluster';

export interface ClusterListHelpers {
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refreshClusters: () => Promise<void>;
}

interface ClusterListManagerProps {
  children: (clusters: Cluster[], helpers: ClusterListHelpers) => React.ReactNode;
}

const ClusterListManager: React.FC<ClusterListManagerProps> = ({ children }) => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/clusters', {
        headers: {
          'x-user-email': localStorage.getItem('currentUser') || '',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 400) {
          setClusters([]);
          setError(null);
          setLastUpdated(new Date());
          return;
        }
        throw new Error('Failed to fetch clusters');
      }

      const data = await response.json();
      setClusters(Array.isArray(data) ? data : []);
      setError(null);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err?.message || 'Unable to reach EKS cluster service');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch clusters every minute
  useEffect(() => {
    fetchClusters(); // Initial fetch
    const interval = setInterval(fetchClusters, 60000); // Every minute
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
