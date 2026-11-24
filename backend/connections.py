from typing import Dict, List, Optional
from pydantic import BaseModel
from datetime import datetime
import boto3
import os
import json
from pathlib import Path

class ConnectionBase(BaseModel):
    accessKey: str
    secretKey: str
    region: Optional[str] = None
    accountName: str
    type: str = "aws"

class Connection(ConnectionBase):
    id: str
    status: str
    createdAt: str
    createdBy: str
    lastUpdated: str

class ConnectionManager:
    def __init__(self, storage_path: str = "connections"):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(exist_ok=True)

    def _get_connection_path(self, connection_id: str) -> Path:
        return self.storage_path / f"{connection_id}.json"

    async def test_connection(self, connection: ConnectionBase) -> tuple[bool, str, Optional[str]]:
        try:
            # Try to create a boto3 client with the credentials
            client = boto3.client(
                'sts',
                aws_access_key_id=connection.accessKey,
                aws_secret_access_key=connection.secretKey,
                region_name=connection.region or 'us-east-1'  # Use us-east-1 as default region
            )
            
            # Try to get caller identity to verify credentials
            identity = client.get_caller_identity()
            account_id = identity['Account']
            return True, "Connection successful", account_id
        except Exception as e:
            error_message = str(e)
            if "InvalidClientTokenId" in error_message:
                return False, "Invalid AWS Access Key ID", None
            elif "SignatureDoesNotMatch" in error_message:
                return False, "Invalid AWS Secret Access Key", None
            elif "InvalidAccessKeyId" in error_message:
                return False, "Invalid AWS Access Key ID", None
            print(f"Connection test failed: {error_message}")
            return False, f"Connection failed: {error_message}", None

    async def create_connection(self, connection: ConnectionBase, user_email: str) -> Connection:
        # Test the connection first
        is_valid, message, account_id = await self.test_connection(connection)
        if not is_valid:
            raise ValueError(message)

        # Generate a unique ID (you might want to use UUID or another method)
        connection_id = f"{connection.type}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        
        # Create the full connection object
        now = datetime.utcnow().isoformat()
        conn = Connection(
            id=connection_id,
            status="connected",
            createdAt=now,
            createdBy=user_email,
            lastUpdated=now,
            **connection.dict()
        )

        # Save to file
        with open(self._get_connection_path(connection_id), 'w') as f:
            json.dump(conn.dict(), f)

        return conn

    async def list_connections(self, user_email: Optional[str] = None) -> List[Connection]:
        print(f"Debug: Searching for connections in {self.storage_path}")
        connections = []
        connection_files = list(self.storage_path.glob("*.json"))
        print(f"Debug: Found {len(connection_files)} connection files")
        
        for file_path in connection_files:
            print(f"Debug: Reading connection file {file_path}")
            try:
                with open(file_path) as f:
                    data = json.load(f)
                    if user_email is None or data.get("createdBy") == user_email:
                        print(f"Debug: Found connection for user {data.get('createdBy')}")
                        connections.append(Connection(**data))
            except Exception as e:
                print(f"Debug: Error reading connection file {file_path}: {str(e)}")
                
        print(f"Debug: Returning {len(connections)} connections")
        return connections

    async def delete_connection(self, connection_id: str) -> bool:
        try:
            file_path = self._get_connection_path(connection_id)
            print(f"Debug: Attempting to delete connection file {file_path}")
            if file_path.exists():
                print(f"Debug: File exists, deleting...")
                file_path.unlink()
                print(f"Debug: File deleted successfully")
                return True
            print(f"Debug: File does not exist")
            return False
        except Exception as e:
            print(f"Debug: Error deleting connection: {str(e)}")
            return False

    async def get_connection(self, connection_id: str) -> Optional[Connection]:
        try:
            file_path = self._get_connection_path(connection_id)
            if file_path.exists():
                with open(file_path) as f:
                    data = json.load(f)
                    return Connection(**data)
            return None
        except Exception as e:
            print(f"Error getting connection: {str(e)}")
            return None

    async def get_valid_connection(self, user_email: str) -> Optional[Connection]:
        """Get the first valid AWS connection for the user."""
        connections = await self.list_connections(user_email)
        
        for conn in connections:
            is_valid, _, _ = await self.test_connection(conn)
            if is_valid:
                return conn
        return None

    async def get_aws_client(self, user_email: str, service: str = 'eks', region: Optional[str] = None) -> Optional[boto3.client]:
        """Get a boto3 client using valid credentials."""
        conn = await self.get_valid_connection(user_email)
        if not conn:
            return None
            
        return boto3.client(
            service,
            aws_access_key_id=conn.accessKey,
            aws_secret_access_key=conn.secretKey,
            region_name=region or conn.region or 'us-east-1'  # Use provided region, connection region, or default
        )

    async def get_active_connection(self, user_email: str) -> Optional[Connection]:
        try:
            print(f"Debug: Getting active connection for user {user_email}")
            connections = await self.list_connections(user_email)
            if not connections:
                print("Debug: No connections found")
                return None

            # Sort connections by creation time (newest first)
            sorted_connections = sorted(
                connections,
                key=lambda x: datetime.fromisoformat(x.createdAt),
                reverse=True
            )
            
            print(f"Debug: Found active connection with ID {sorted_connections[0].id}")
            return sorted_connections[0]
        except Exception as e:
            print(f"Debug: Error getting active connection - {str(e)}")
            return None
