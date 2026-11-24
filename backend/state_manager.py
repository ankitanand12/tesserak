import json
import os
from typing import Dict, List, Optional
from datetime import datetime

class StateManager:
    def __init__(self, base_path: str = "states"):
        self.base_path = base_path
        os.makedirs(base_path, exist_ok=True)
    
    def _get_user_state_path(self, user_email: str) -> str:
        """Get the path to user's state directory"""
        sanitized_email = user_email.replace("@", "_at_").replace(".", "_")
        user_path = os.path.join(self.base_path, sanitized_email)
        os.makedirs(user_path, exist_ok=True)
        return user_path
    
    def _get_cluster_state_path(self, user_email: str, cluster_name: str) -> str:
        """Get the path to cluster state file"""
        if not cluster_name or not isinstance(cluster_name, str):
            raise ValueError("Invalid cluster name")
        sanitized_name = "".join(c for c in cluster_name if c.isalnum() or c in ('-', '_'))
        if not sanitized_name:
            raise ValueError("Cluster name contains no valid characters")
        user_path = self._get_user_state_path(user_email)
        return os.path.join(user_path, f"{sanitized_name}.json")
    
    def save_cluster_state(self, user_email: str, cluster_name: str, state: Dict) -> None:
        """Save cluster state to file"""
        state_path = self._get_cluster_state_path(user_email, cluster_name)
        state_with_metadata = {
            "last_updated": datetime.utcnow().isoformat(),
            "cluster_name": cluster_name,
            "user_email": user_email,
            "state": state
        }
        with open(state_path, "w") as f:
            json.dump(state_with_metadata, f, indent=2)
    
    def get_cluster_state(self, user_email: str, cluster_name: str) -> Optional[Dict]:
        """Get cluster state from file"""
        state_path = self._get_cluster_state_path(user_email, cluster_name)
        if not os.path.exists(state_path):
            return None
        with open(state_path, "r") as f:
            return json.load(f)
    
    def list_user_clusters(self, user_email: str) -> List[str]:
        """List all clusters for a user"""
        user_path = self._get_user_state_path(user_email)
        clusters = []
        for file in os.listdir(user_path):
            if file.endswith(".json"):
                clusters.append(file[:-5])  # Remove .json extension
        return clusters
    
    def delete_cluster_state(self, user_email: str, cluster_name: str) -> bool:
        """Delete cluster state file"""
        state_path = self._get_cluster_state_path(user_email, cluster_name)
        if os.path.exists(state_path):
            os.remove(state_path)
            return True
        return False

    def compare_with_aws_state(self, user_email: str, cluster_name: str, aws_state: Dict) -> Dict:
        """Compare local state with AWS state"""
        try:
            if not aws_state:
                return {"status": "aws_state_missing", "aws_state": None}

            local_state = self.get_cluster_state(user_email, cluster_name)
            if not local_state:
                return {"status": "missing_local", "aws_state": aws_state}
            
            # Compare relevant fields
            local = local_state.get("state", {})
            if not local:
                return {"status": "invalid_local_state", "aws_state": aws_state}
            
            diffs = []
            
            # Compare node groups
            local_nodes = local.get("nodeGroups", [])
            aws_nodes = aws_state.get("nodeGroups", [])
            
            if len(local_nodes) != len(aws_nodes):
                diffs.append("node_group_count_mismatch")
            
            # Compare other important fields
            fields_to_compare = ["version", "status", "endpoint"]
            for field in fields_to_compare:
                if local.get(field) != aws_state.get(field):
                    diffs.append(f"{field}_mismatch")
            
            return {
                "status": "differences_found" if diffs else "in_sync",
                "differences": diffs,
                "local_state": local_state,
                "aws_state": aws_state
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "aws_state": aws_state
            }
