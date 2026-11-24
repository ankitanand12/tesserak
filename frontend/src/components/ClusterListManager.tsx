import React, { useState, useEffect } from 'react';
import { Cluster } from '../types/cluster';

interface ClusterListManagerProps {
  children: (clusters: Cluster[]) => React.ReactNode;
}

const ClusterListManager: React.FC<ClusterListManagerProps> = ({ children }) => {
  const [clusters, setClusters] = useState<Cluster[]>([]);

  const fetchClusters = async () => {
    try {
      const response = await fetch('http://localhost:8000/clusters', {
        headers: {
          'x-user-email': localStorage.getItem('currentUser') || '',
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        if (response.status === 400) {
          setClusters([]);
          return;
        }
        throw new Error('Failed to fetch clusters');
      }
      
      const data = await response.json();
      setClusters(data);
    } catch (error) {
      console.error('Error fetching clusters:', error);
    }
  };

  // Fetch clusters every minute
  useEffect(() => {
    fetchClusters(); // Initial fetch
    const interval = setInterval(fetchClusters, 60000); // Every minute
    return () => clearInterval(interval);
  }, []);

  return <>{children(clusters)}</>;
};

export default ClusterListManager;
