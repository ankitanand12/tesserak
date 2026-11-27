from typing import Optional
from fastapi import Request
import json
import boto3
import os
from datetime import datetime

class StateData:
    def __init__(self):
        self.eks_client = boto3.client(
            'eks',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
            region_name=os.getenv('AWS_REGION', 'us-west-2')
        )

    async def get_cluster_details(self, cluster_name: str) -> Optional[dict]:
        """Get detailed cluster information from AWS"""
        try:
            response = self.eks_client.describe_cluster(name=cluster_name)
            cluster = response['cluster']
            
            # Get node groups
            nodegroups_response = self.eks_client.list_nodegroups(clusterName=cluster_name)
            nodegroups = []
            
            for ng_name in nodegroups_response.get('nodegroups', []):
                ng_details = self.eks_client.describe_nodegroup(
                    clusterName=cluster_name,
                    nodegroupName=ng_name
                )
                nodegroups.append(ng_details['nodegroup'])
            
            return {
                "name": cluster_name,
                "status": cluster['status'],
                "version": cluster['version'],
                "endpoint": cluster.get('endpoint'),
                "nodeGroups": nodegroups,
                "vpc": cluster.get('resourcesVpcConfig', {}),
                "logging": cluster.get('logging', {}),
                "lastUpdated": datetime.utcnow().isoformat(),
                "tags": cluster.get('tags', {})
            }
        except Exception as e:
            print(f"Error getting cluster details: {str(e)}")
            return None

    def create_initial_state(self, cluster_request: dict, user_email: str) -> dict:
        """Create initial state for a new cluster"""
        return {
            "name": cluster_request["name"],
            "region": cluster_request["region"],
            "nodeGroups": [{
                "name": cluster_request["nodeGroupName"],
                "instanceType": cluster_request["instanceType"],
                "desiredSize": cluster_request["desiredNodes"],
                "minSize": cluster_request["minNodes"],
                "maxSize": cluster_request["maxNodes"]
            }],
            "status": "CREATING",
            "createdBy": user_email,
            "createdAt": datetime.utcnow().isoformat(),
            "lastUpdated": datetime.utcnow().isoformat(),
            "desiredState": cluster_request,
            "history": []
        }

    def record_state_change(self, current_state: dict, change_type: str, details: dict) -> dict:
        """Record a change in the cluster state"""
        updated = dict(current_state.get("state", current_state))
        history_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "type": change_type,
            "details": details
        }
        
        updated["history"] = list(updated.get("history", []))
        updated["history"].append(history_entry)
        updated["lastUpdated"] = datetime.utcnow().isoformat()

        # Sync top-level comparison attributes if provided directly or nested under aws_state
        source_aws = details.get("aws_state") if isinstance(details, dict) else None
        for key in ("status", "version", "endpoint", "nodeGroups", "communityAddons"):
            if isinstance(details, dict) and details.get(key) is not None:
                updated[key] = details[key]
            elif isinstance(source_aws, dict) and source_aws.get(key) is not None:
                updated[key] = source_aws[key]

        return updated
