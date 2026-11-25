import json
from datetime import datetime
from typing import Dict, List, Optional

from db import ClusterStateRecord, DatabaseManager, get_db, normalize_email


class StateManager:
    def __init__(self, base_path: str = "states", db: Optional[DatabaseManager] = None):
        self.base_path = base_path
        self.db = db or get_db()

    @staticmethod
    def _validate_cluster_name(cluster_name: str) -> str:
        if not cluster_name or not isinstance(cluster_name, str):
            raise ValueError("Invalid cluster name")
        sanitized_name = "".join(c for c in cluster_name if c.isalnum() or c in ('-', '_'))
        if not sanitized_name:
            raise ValueError("Cluster name contains no valid characters")
        return cluster_name

    def save_cluster_state(self, user_email: str, cluster_name: str, state: Dict) -> None:
        """Save cluster state to PostgreSQL"""
        self._validate_cluster_name(cluster_name)
        clean_email = normalize_email(user_email)
        now = datetime.utcnow().isoformat()
        serializable_state = json.loads(json.dumps(state, default=str))
        with self.db.session_scope() as session:
            existing = (
                session.query(ClusterStateRecord)
                .filter(
                    ClusterStateRecord.user_email == clean_email,
                    ClusterStateRecord.cluster_name == cluster_name,
                )
                .first()
            )
            if existing:
                existing.last_updated = now
                existing.state_json = serializable_state
            else:
                session.add(
                    ClusterStateRecord(
                        user_email=clean_email,
                        cluster_name=cluster_name,
                        last_updated=now,
                        state_json=serializable_state,
                    )
                )

    def get_cluster_state(self, user_email: str, cluster_name: str) -> Optional[Dict]:
        """Get cluster state from PostgreSQL"""
        self._validate_cluster_name(cluster_name)
        clean_email = normalize_email(user_email)
        with self.db.session_scope() as session:
            row = (
                session.query(ClusterStateRecord)
                .filter(
                    ClusterStateRecord.user_email == clean_email,
                    ClusterStateRecord.cluster_name == cluster_name,
                )
                .first()
            )
            if not row:
                return None
            return {
                "last_updated": row.last_updated,
                "cluster_name": row.cluster_name,
                "user_email": row.user_email,
                "state": row.state_json,
            }

    def list_user_clusters(self, user_email: str) -> List[str]:
        """List all clusters for a user from PostgreSQL"""
        clean_email = normalize_email(user_email)
        with self.db.session_scope() as session:
            rows = (
                session.query(ClusterStateRecord.cluster_name)
                .filter(ClusterStateRecord.user_email == clean_email)
                .order_by(ClusterStateRecord.cluster_name.asc())
                .all()
            )
            return [r[0] for r in rows]

    def delete_cluster_state(self, user_email: str, cluster_name: str) -> bool:
        """Delete cluster state from PostgreSQL"""
        self._validate_cluster_name(cluster_name)
        clean_email = normalize_email(user_email)
        with self.db.session_scope() as session:
            row = (
                session.query(ClusterStateRecord)
                .filter(
                    ClusterStateRecord.user_email == clean_email,
                    ClusterStateRecord.cluster_name == cluster_name,
                )
                .first()
            )
            if not row:
                return False
            session.delete(row)
            return True

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
