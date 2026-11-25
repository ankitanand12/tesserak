from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
import boto3
import os
import logging
from dotenv import load_dotenv
from state_manager import StateManager
from state_management import StateData
from connections import ConnectionManager, Connection, ConnectionBase
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(
    title="Tesserak | EKS Cluster Manager",
    description="Multi-dimensional Kubernetes & cloud infrastructure control API",
)

# Initialize managers
state_manager = StateManager(base_path="cluster_states")
state_data = StateData()
connection_manager = ConnectionManager(storage_path="connections")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# AWS client will be created per-request based on the user's credentials


class AddonModel(BaseModel):
    id: str
    name: str
    type: str
    version: str
    configuration: Optional[dict] = None

async def get_compatible_aws_addon_version(eks_client, addon_name: str, eks_version: str, requested_version: str = None) -> str:
    """Return a compatible addon version for the given EKS version, or None if not found."""
    try:
        resp = eks_client.describe_addon_versions(
            addonName=addon_name,
            kubernetesVersion=eks_version
        )
        versions = resp.get('addons', [{}])[0].get('addonVersions', [])
        compatible_versions = [v['addonVersion'] for v in versions if v.get('compatibilities')]
        
        if requested_version and requested_version in compatible_versions:
            return requested_version
        if compatible_versions:
            # Return the latest compatible version
            return compatible_versions[0]
        return None
    except Exception as e:
        return None

def parse_version(version_str: str) -> list:
    """Parse version string into numeric components for sorting"""
    # Remove 'v' prefix if present
    version_str = version_str.lower().replace('v', '')
    
    # Handle eksbuild versions
    if 'eksbuild.' in version_str:
        version_str = version_str.split('eksbuild.')[0]
    
    try:
        # Split into numeric components
        parts = version_str.split('.')
        # Convert to integers and pad with zeros
        nums = [int(p) for p in parts] + [0] * (4 - len(parts))
        return nums
    except ValueError:
        return [0, 0, 0, 0]

@app.get("/api/aws/addon-versions/{eks_version}")
async def get_addon_versions(eks_version: str, x_user_email: str = Header(...)) -> Dict[str, List[Dict[str, Any]]]:
    """Get available versions for all common EKS addons."""
    try:
        # Get active connection for the user
        conn = await connection_manager.get_active_connection(x_user_email)
        if not conn:
            raise HTTPException(status_code=400, detail="No active AWS connection found")

        # Initialize AWS client with user's credentials
        session = boto3.Session(
            aws_access_key_id=conn.accessKey,
            aws_secret_access_key=conn.secretKey,
            region_name=conn.region or 'us-east-1'
        )
        eks_client = session.client('eks')
        
        # List of common EKS addons with their AWS names and default versions
        aws_addons = {
            'vpc-cni': {'name': 'vpc-cni', 'default': 'v1.15.0-eksbuild.2'},
            'coredns': {'name': 'coredns', 'default': 'v1.10.1-eksbuild.1'},
            'kube-proxy': {'name': 'kube-proxy', 'default': f'v{eks_version}-minimal-eksbuild.1'},
            'aws-ebs-csi-driver': {'name': 'aws-ebs-csi-driver', 'default': 'v1.25.0-eksbuild.1'},
            'aws-efs-csi-driver': {'name': 'aws-efs-csi-driver', 'default': 'v1.7.0-eksbuild.1'},
            'aws-fsx-csi-driver': {'name': 'aws-fsx-csi-driver', 'default': 'v1.7.0-eksbuild.1'},
            'eks-pod-identity-agent': {'name': 'eks-pod-identity-agent', 'default': 'v1.0.0-eksbuild.1'}
        }
        
        addon_versions = {}
        
        # Fetch versions for each addon using pagination
        for frontend_id, addon_info in aws_addons.items():
            try:
                aws_name = addon_info['name']
                logger.info(f"Fetching versions for {aws_name}")
                
                # Use paginator to get all versions
                paginator = eks_client.get_paginator('describe_addon_versions')
                all_versions = []
                
                try:
                    # First try with kubernetes version filter for faster results
                    for page in paginator.paginate(
                        addonName=aws_name,
                        kubernetesVersion=eks_version
                    ):
                        if not page.get('addons'):
                            continue
                        all_versions.extend(page['addons'][0].get('addonVersions', []))
                        
                    logger.info(f"Found {len(all_versions)} versions for {aws_name} with k8s filter")
                    
                    # If no versions found with filter, try without filter to get all versions
                    if not all_versions:
                        for page in paginator.paginate(addonName=aws_name):
                            if not page.get('addons'):
                                continue
                            all_versions.extend(page['addons'][0].get('addonVersions', []))
                        logger.info(f"Found {len(all_versions)} total versions for {aws_name} without filter")
                    
                    # Process versions and check compatibility
                    compatible_versions = []
                    for version in all_versions:
                        version_info = {
                            'version': version['addonVersion'],
                            'defaultVersion': False,
                            'isLatest': False,
                            'compatibleWithCurrentK8s': False
                        }
                        
                        # Check version compatibility
                        for compat in version.get('compatibilities', []):
                            cluster_version = compat.get('clusterVersion', '')
                            # Check exact version match or major version match
                            if cluster_version == eks_version or eks_version.startswith(cluster_version.split('.')[0] + '.'):
                                version_info.update({
                                    'defaultVersion': compat.get('defaultVersion', False),
                                    'isLatest': compat.get('isLatest', False),
                                    'compatibleWithCurrentK8s': True
                                })
                                compatible_versions.append(version_info)
                                break
                    
                    # If no compatible versions found, use default version
                    if not compatible_versions:
                        default_version = addon_info['default']
                        logger.info(f"No compatible versions found for {aws_name}, using default: {default_version}")
                        compatible_versions.append({
                            'version': default_version,
                            'defaultVersion': True,
                            'isLatest': False,
                            'compatibleWithCurrentK8s': True
                        })
                    else:
                        # Sort versions newest to oldest
                        compatible_versions.sort(
                            key=lambda v: parse_version(v['version']),
                            reverse=True
                        )
                        
                        # Mark newest version as latest if none is marked
                        if not any(v['isLatest'] for v in compatible_versions):
                            compatible_versions[0]['isLatest'] = True
                        
                        logger.info(f"Found {len(compatible_versions)} compatible versions for {aws_name}: {[v['version'] for v in compatible_versions]}")
                    
                    addon_versions[frontend_id] = compatible_versions
                    
                except Exception as e:
                    logger.error(f"Error fetching versions for {aws_name}: {str(e)}")
                    # Use default version on error
                    default_version = addon_info['default']
                    addon_versions[frontend_id] = [{
                        'version': default_version,
                        'defaultVersion': True,
                        'isLatest': False,
                        'compatibleWithCurrentK8s': True
                    }]
            except Exception as e:
                logger.error(f"Error processing addon {aws_name}: {str(e)}")
                addon_versions[frontend_id] = []
        
        return addon_versions
        
    except Exception as e:
        logger.error(f"Error in get_addon_versions: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def install_aws_addon(eks_client, cluster_name: str, addon: AddonModel, eks_version: str) -> dict:
    """Install an AWS addon in the cluster, checking compatibility first."""
    compatible_version = await get_compatible_aws_addon_version(eks_client, addon.id, eks_version, addon.version)
    if not compatible_version:
        return {"status": "error", "details": f"No compatible version found for {addon.id} with EKS {eks_version}"}
    try:
        response = eks_client.create_addon(
            clusterName=cluster_name,
            addonName=addon.id,
            addonVersion=compatible_version,
            resolveConflicts='OVERWRITE'
        )
        return {"status": "success", "details": response["addon"], "usedVersion": compatible_version}
    except Exception as e:
        return {"status": "error", "details": str(e), "usedVersion": compatible_version}

async def install_community_addon(cluster_name: str, addon: AddonModel) -> dict:
    """Install a community addon using Helm."""
    # TODO: Implement Helm-based installation
    # For now, return success without actual installation
    return {"status": "success", "details": "Community add-on installation not yet implemented"}

class ClusterRequest(BaseModel):
    name: str
    region: str
    nodeGroupName: str
    instanceType: str = "t3.medium"
    desiredNodes: int = 2
    minNodes: int = 1
    maxNodes: int = 3
    addons: Optional[List[AddonModel]] = []

class ClusterResponse(BaseModel):
    name: str
    status: str
    accountId: str
    region: str
    version: str
    endpoint: Optional[str] = None
    stateStatus: str
    createdAt: datetime
    deletedAt: Optional[datetime] = None
    deletedBy: Optional[str] = None  # 'aws-console' or 'tool'

@app.get("/")
async def root():
    return {"message": "Tesserak | EKS Cluster Management API"}

@app.post("/clusters", response_model=ClusterResponse)
async def create_cluster(cluster: ClusterRequest, x_user_email: str = Header(...)):
    try:
        # Get AWS client with user's credentials
        eks_client = await connection_manager.get_aws_client(x_user_email)
        if not eks_client:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in the Connectors section."
            )

        # Get account ID for the response
        connection = await connection_manager.get_active_connection(x_user_email)
        account_id = 'unknown'
        if connection:
            try:
                sts_client = boto3.client('sts',
                    aws_access_key_id=connection.accessKey,
                    aws_secret_access_key=connection.secretKey,
                    region_name=connection.region or 'us-east-1'
                )
                account_id = sts_client.get_caller_identity()['Account']
            except Exception:
                pass

        # Create initial state before creating the cluster
        initial_state = state_data.create_initial_state(cluster.dict(), x_user_email)
        state_manager.save_cluster_state(x_user_email, cluster.name, initial_state)

        # Create cluster in AWS
        response = eks_client.create_cluster(
            name=cluster.name,
            version='1.27',
            roleArn=os.getenv('EKS_CLUSTER_ROLE_ARN'),
            resourcesVpcConfig={
                'subnetIds': os.getenv('SUBNET_IDS', '').split(','),
                'endpointPublicAccess': True,
                'endpointPrivateAccess': False
            }
        )

        # Update state with AWS response
        aws_details = {
            "status": response['cluster']['status'],
            "version": response['cluster']['version'],
            "endpoint": response['cluster'].get('endpoint'),
            "aws_response": response['cluster']
        }
        
        # Wait for cluster to be active before installing add-ons
        waiter = eks_client.get_waiter('cluster_active')
        waiter.wait(
            name=cluster.name,
            WaiterConfig={'Delay': 30, 'MaxAttempts': 40}  # Wait up to 20 minutes
        )

        # Install add-ons with compatibility check
        eks_version = response['cluster']['version']
        addon_results = []
        for addon in cluster.addons:
            if addon.type == 'aws':
                result = await install_aws_addon(eks_client, cluster.name, addon, eks_version)
            else:
                result = await install_community_addon(cluster.name, addon)
            addon_results.append({"addon": addon.dict(), "result": result})
        updated_state = state_data.record_state_change(initial_state, "create", aws_details)
        state_manager.save_cluster_state(x_user_email, cluster.name, updated_state)

        # Install selected add-ons (placeholder logic)
        if cluster.addons:
            for addon in cluster.addons:
                # Here you would call the relevant AWS or kubectl APIs to install the add-on
                # For now, just print/log the action
                print(f"[INFO] Installing add-on: {addon.name} (type: {addon.type}) for cluster {cluster.name}")
                # TODO: Implement actual add-on installation logic

        return ClusterResponse(
            name=response['cluster']['name'],
            status=response['cluster']['status'],
            accountId=account_id,
            region=cluster.region,
            version=response['cluster'].get('version', '1.27'),
            endpoint=response['cluster'].get('endpoint'),
            stateStatus='synced',
            createdAt=datetime.utcnow()
        )
    except Exception as e:
        # Record failed state
        if 'initial_state' in locals():
            failed_state = state_data.record_state_change(
                initial_state,
                "create_failed",
                {"error": str(e)}
            )
            state_manager.save_cluster_state(x_user_email, cluster.name, failed_state)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/clusters", response_model=List[ClusterResponse])
async def list_clusters(x_user_email: str = Header(...)):
    try:
        # Get AWS client with user's credentials
        eks_client = await connection_manager.get_aws_client(x_user_email)
        if not eks_client:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in the Connectors section."
            )

        response = eks_client.list_clusters()
        clusters = []
        
        # Get the active connection and AWS account ID
        connection = await connection_manager.get_active_connection(x_user_email)
        if not connection:
            raise HTTPException(status_code=400, detail="No active connection found")
            
        sts_client = boto3.client('sts',
            aws_access_key_id=connection.accessKey,
            aws_secret_access_key=connection.secretKey,
            region_name=connection.region
        )
        account_id = sts_client.get_caller_identity()['Account']

        # Merge local cluster states with live AWS EKS clusters
        local_cluster_names = state_manager.list_user_clusters(x_user_email)
        aws_cluster_names = response.get('clusters', [])
        all_cluster_names = sorted(set(local_cluster_names) | set(aws_cluster_names))

        all_states = []
        for cname in all_cluster_names:
            cstate = state_manager.get_cluster_state(x_user_email, cname)
            if cstate:
                state_data_entry = dict(cstate.get('state', cstate))
                if 'name' not in state_data_entry:
                    state_data_entry['name'] = cname
                all_states.append(state_data_entry)
            else:
                all_states.append({'name': cname, '_aws_only': True})
        current_time = datetime.utcnow()

        for state in all_states:
            cluster_name = state.get('name')
            if not cluster_name:
                continue

            # Skip clusters deleted more than 7 days ago
            if state.get('deletedAt'):
                deleted_at = datetime.fromisoformat(state['deletedAt'])
                if (current_time - deleted_at).days > 7:
                    continue

            try:
                # Try to get cluster info from AWS
                cluster_info = eks_client.describe_cluster(name=cluster_name)['cluster']
                aws_state = {
                    "status": cluster_info['status'],
                    "endpoint": cluster_info.get('endpoint'),
                    "version": cluster_info.get('version'),
                    "aws_response": cluster_info
                }
                
                # Compare states
                if state.get('_aws_only'):
                    state_status = 'missing_local'
                else:
                    try:
                        comparison = state_manager.compare_with_aws_state(x_user_email, cluster_name, aws_state)
                        state_status = comparison['status']
                        if state_status == 'in_sync':
                            state_status = 'synced'
                    except Exception:
                        state_status = 'unknown'

                raw_created = state.get('createdAt') or cluster_info.get('createdAt') or datetime.utcnow()
                if isinstance(raw_created, str):
                    created_at_val = datetime.fromisoformat(raw_created.replace('Z', '+00:00'))
                else:
                    created_at_val = raw_created

                clusters.append(
                    ClusterResponse(
                        name=cluster_info['name'],
                        status=cluster_info['status'],
                        accountId=account_id,
                        region=cluster_info['arn'].split(':')[3],
                        version=cluster_info['version'],
                        endpoint=cluster_info.get('endpoint'),
                        stateStatus=state_status,
                        createdAt=created_at_val,
                        deletedAt=state.get('deletedAt'),
                        deletedBy=state.get('deletedBy')
                    )
                )
            except eks_client.exceptions.ResourceNotFoundException:
                # Cluster not found in AWS but exists in our state
                if not state.get('deletedAt'):
                    # Mark as deleted by AWS console if not already marked as deleted
                    state['deletedAt'] = current_time.isoformat()
                    state['deletedBy'] = 'aws-console'
                    state_manager.save_cluster_state(x_user_email, cluster_name, state)
                
                clusters.append(
                    ClusterResponse(
                        name=cluster_name,
                        status='NOT_AVAILABLE',
                        accountId=account_id,
                        region=state.get('region', 'unknown'),
                        version=state.get('version', 'unknown'),
                        endpoint=None,
                        stateStatus='deleted',
                        createdAt=datetime.fromisoformat(state['createdAt']) if state.get('createdAt') else datetime.utcnow(),
                        deletedAt=datetime.fromisoformat(state['deletedAt']) if state.get('deletedAt') else None,
                        deletedBy=state.get('deletedBy')
                    )
                )
        
        return clusters
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/clusters/{cluster_name}")
async def delete_cluster(cluster_name: str, x_user_email: str = Header(...)):
    try:
        # Get AWS client with user's credentials
        eks_client = await connection_manager.get_aws_client(x_user_email)
        if not eks_client:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in the Connectors section."
            )

        # Get current state before deletion
        current_state = state_manager.get_cluster_state(x_user_email, cluster_name)
        if current_state:
            # Record deletion in state
            updated_state = state_data.record_state_change(
                current_state,
                "delete_initiated",
                {"timestamp": datetime.utcnow().isoformat()}
            )
            state_manager.save_cluster_state(x_user_email, cluster_name, updated_state)
        
        # Delete from AWS
        eks_client.delete_cluster(name=cluster_name)
        
        # Keep state file for history but mark as deleted
        if current_state:
            final_state = state_data.record_state_change(
                updated_state,
                "deleted",
                {"timestamp": datetime.utcnow().isoformat()}
            )
            state_manager.save_cluster_state(x_user_email, cluster_name, final_state)
        
        return {"message": f"Cluster {cluster_name} deletion initiated"}
    except Exception as e:
        if 'current_state' in locals() and 'updated_state' in locals():
            failed_state = state_data.record_state_change(
                updated_state,
                "delete_failed",
                {"error": str(e)}
            )
            state_manager.save_cluster_state(x_user_email, cluster_name, failed_state)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/clusters/{cluster_name}/sync")
async def sync_cluster_state(cluster_name: str, x_user_email: str = Header(...)):
    try:
        # Get AWS client with user's credentials
        eks_client = await connection_manager.get_aws_client(x_user_email)
        if not eks_client:
            raise HTTPException(
                status_code=400,
                detail="No valid AWS connection found. Please add AWS credentials in the Connectors section."
            )

        # Get current AWS state
        cluster_info = eks_client.describe_cluster(name=cluster_name)['cluster']
        aws_state = {
            "status": cluster_info['status'],
            "endpoint": cluster_info.get('endpoint'),
            "version": cluster_info.get('version'),
            "aws_response": cluster_info
        }
        
        # Get current local state
        current_state = state_manager.get_cluster_state(x_user_email, cluster_name)
        if current_state:
            # Update existing state
            updated_state = state_data.record_state_change(
                current_state,
                "sync",
                {"aws_state": aws_state}
            )
        else:
            # Create new state if none exists
            updated_state = state_data.record_state_change(
                {"name": cluster_name},
                "initial_sync",
                {"aws_state": aws_state}
            )
        
        # Save updated state
        state_manager.save_cluster_state(x_user_email, cluster_name, updated_state)
        
        return {"message": "State synchronized successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/connections/test")
async def test_connection(connection: ConnectionBase):
    try:
        is_valid, message, account_id = await connection_manager.test_connection(connection)
        if is_valid:
            return {"status": "success", "message": message, "accountId": account_id}
        raise HTTPException(status_code=400, detail=message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/connections", response_model=Connection)
async def create_connection(connection: ConnectionBase, x_user_email: str = Header(...)):
    try:
        return await connection_manager.create_connection(connection, x_user_email)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/connections", response_model=List[Connection])
async def list_connections(x_user_email: str = Header(...)):
    try:
        return await connection_manager.list_connections(x_user_email)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/connections/{connection_id}")
async def delete_connection(connection_id: str):
    try:
        if await connection_manager.delete_connection(connection_id):
            return {"status": "success"}
        raise HTTPException(status_code=404, detail="Connection not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/connections/status", response_model=List[Dict])
async def check_connections_status(x_user_email: str = Header(...)):
    try:
        connections = await connection_manager.list_connections(x_user_email)
        if not connections:
            return []
            
        status_list = []
        for conn in connections:
            is_valid, message, account_id = await connection_manager.test_connection(conn)
            status_list.append({
                "id": conn.id,
                "status": "connected" if is_valid else "disconnected",
                "message": message,
                "accountId": account_id if is_valid else None
            })
        
        return status_list
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/aws/regions/{account_id}")
async def get_aws_regions(account_id: str, x_user_email: str = Header(...)):
    try:
        # Get user's connection
        connection = await connection_manager.get_active_connection(x_user_email)
        if not connection:
            raise HTTPException(status_code=400, detail="No active connection found")

        print(f"Debug: Found connection for {x_user_email}")
        print(f"Debug: Access Key starts with: {connection.accessKey[:4] if connection.accessKey else 'None'}")
        
        try:
            # Create AWS client
            client = boto3.client('ec2',
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name='us-east-1'  # Use a default region to list all regions
            )
            print("Debug: Created EC2 client successfully")
            
            # Test credentials with a simple STS call first
            sts = boto3.client('sts',
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name='us-east-1'
            )
            account_info = sts.get_caller_identity()
            print(f"Debug: Successfully authenticated as account {account_info['Account']}")
            
            # Get list of regions
            regions = client.describe_regions()['Regions']
            return [region['RegionName'] for region in regions]
            
        except Exception as aws_error:
            print(f"Debug: AWS Error - {str(aws_error)}")
            raise HTTPException(status_code=500, detail=f"AWS Error: {str(aws_error)}")
            
    except Exception as e:
        print(f"Debug: General Error - {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/aws/vpcs/{account_id}/{region}")
async def get_aws_vpcs(account_id: str, region: str, x_user_email: str = Header(...)):
    try:
        # Get user's connection
        connection = await connection_manager.get_active_connection(x_user_email)
        if not connection:
            raise HTTPException(status_code=400, detail="No active connection found")

        # Create AWS client for EC2 in the specified region
        client = boto3.client('ec2',
            aws_access_key_id=connection.accessKey,
            aws_secret_access_key=connection.secretKey,
            region_name=region
        )
        
        # Get list of VPCs
        response = client.describe_vpcs()
        vpcs = []
        for vpc in response['Vpcs']:
            name = ''
            if 'Tags' in vpc:
                for tag in vpc['Tags']:
                    if tag['Key'] == 'Name':
                        name = tag['Value']
                        break
                        
            vpc_info = {
                'id': vpc['VpcId'],
                'cidr': vpc['CidrBlock'],
                'name': name or vpc['VpcId'],
                'isDefault': vpc.get('IsDefault', False)
            }
            vpcs.append(vpc_info)
            
        return vpcs
    except Exception as e:
        print(f"Debug: Error fetching VPCs - {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/aws/zones/{account_id}/{region}")
async def get_aws_availability_zones(account_id: str, region: str, x_user_email: str = Header(...)):
    try:
        # Get user's connection
        connection = await connection_manager.get_active_connection(x_user_email)
        if not connection:
            raise HTTPException(status_code=400, detail="No active connection found")

        print(f"Debug: Getting AZs for region {region}")
        
        # Create AWS client for EC2 in the specified region
        client = boto3.client('ec2',
            aws_access_key_id=connection.accessKey,
            aws_secret_access_key=connection.secretKey,
            region_name=region
        )
        
        # Get list of availability zones
        response = client.describe_availability_zones(
            Filters=[
                {
                    'Name': 'region-name',
                    'Values': [region]
                },
                {
                    'Name': 'state',
                    'Values': ['available']
                }
            ]
        )
        
        zones = []
        for zone in response['AvailabilityZones']:
            zone_info = {
                'id': zone['ZoneId'],
                'name': zone['ZoneName'],
                'state': zone['State'],
                'region': zone['RegionName']
            }
            zones.append(zone_info)
            
        print(f"Debug: Found {len(zones)} availability zones")
        return zones
        
    except Exception as e:
        print(f"Debug: Error fetching availability zones - {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

from atmosly_router import router as atmosly_router
app.include_router(atmosly_router)
