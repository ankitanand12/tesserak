import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pipelines_service
import resources_service
import main as backend_main


class RegressionFixesTest(unittest.TestCase):
    def setUp(self):
        backend_main._EKS_META_CACHE.clear()

    def test_pipeline_stage5_waits_for_rollout_before_capturing_pods(self):
        calls = []

        def fake_run_cmd(cmd, cwd=None, env=None, timeout=120):
            calls.append(cmd)
            if "rollout" in cmd and "status" in cmd:
                return 0, 'deployment "demo-app-deployment" successfully rolled out', 4.2
            if "get" in cmd and "deployments,pods,svc" in cmd:
                return (
                    0,
                    "pod/demo-app-deployment-1   1/1   Running   0   12s   10.42.5.71",
                    0.5,
                )
            return 0, "", 0.1

        with patch.object(pipelines_service, "_run_cmd", side_effect=fake_run_cmd):
            ok, log, dur = pipelines_service._verify_cluster_rollout(
                ["kubectl"],
                {"KUBECONFIG": "/tmp/kc"},
                "default",
                "deployment.apps/demo-app-deployment created",
            )

        self.assertTrue(ok)
        self.assertIn("successfully rolled out", log)
        self.assertIn("Running", log)
        self.assertEqual(calls[0][:4], ["kubectl", "rollout", "status", "deployment.apps/demo-app-deployment"])
        self.assertEqual(calls[1][:3], ["kubectl", "get", "deployments,pods,svc"])
        self.assertGreater(dur, 4.0)

    def test_pipeline_stage5_failure_captures_warning_events(self):
        def fake_run_cmd(cmd, cwd=None, env=None, timeout=120):
            if "rollout" in cmd:
                return 1, "error: timed out waiting for the condition", 120.0
            if "events" in cmd:
                return 0, "Warning  Failed  ErrImagePull", 0.2
            return 0, "pod/demo-app-1   0/1   ErrImagePull", 0.3

        with patch.object(pipelines_service, "_run_cmd", side_effect=fake_run_cmd):
            ok, log, _ = pipelines_service._verify_cluster_rollout(
                ["kubectl"],
                {},
                "default",
                "deployment.apps/demo-app created",
            )

        self.assertFalse(ok)
        self.assertIn("Recent Warning Events", log)
        self.assertIn("ErrImagePull", log)

    def test_scan_s3_handles_more_than_15_paginated_buckets_and_sorts_newest(self):
        older = datetime(2026, 1, 1, tzinfo=timezone.utc)
        newest = datetime(2026, 11, 25, 23, 52, 25, tzinfo=timezone.utc)
        page1 = [{"Name": f"aaa-bucket-{i:02d}", "CreationDate": older} for i in range(40)]
        page2 = [{"Name": f"mmm-bucket-{i:02d}", "CreationDate": older} for i in range(29)]
        page2.append({"Name": "tesserak-beta", "CreationDate": newest})

        fake_s3 = MagicMock()
        fake_s3.list_buckets.side_effect = [
            {"Buckets": page1, "ContinuationToken": "tok-2"},
            {"Buckets": page2},
        ]
        fake_s3.get_bucket_encryption.return_value = {"ServerSideEncryptionConfiguration": {}}
        fake_s3.get_public_access_block.return_value = {
            "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            }
        }

        conn = SimpleNamespace(accessKey="AKIA_TEST", secretKey="SECRET", region="us-east-1")
        with patch.object(resources_service, "_thread_client", return_value=fake_s3):
            items, warnings = resources_service._scan_s3_sync(conn, "us-east-1", "2026-11-25T23:55:00Z")

        self.assertEqual(warnings, [])
        self.assertEqual(len(items), 70)
        self.assertEqual(items[0]["name"], "tesserak-beta")

    def test_deleted_cluster_retained_under_7_days_and_removed_after_7_days(self):
        now = datetime.utcnow()
        keep_ts = (now - timedelta(days=6, hours=20)).replace(tzinfo=timezone.utc).isoformat()
        expired_ts = (now - timedelta(days=7, minutes=5)).isoformat()

        fake_eks = MagicMock()
        fake_eks.list_clusters.return_value = {"clusters": []}

        class _NotFound(Exception):
            pass

        fake_eks.exceptions = SimpleNamespace(ResourceNotFoundException=_NotFound)
        fake_eks.describe_cluster.side_effect = _NotFound("gone")

        states = {
            "recent-deleted": {"name": "recent-deleted", "region": "us-east-1", "version": "1.34", "deletedAt": keep_ts, "deletedBy": "tesserak"},
            "old-deleted": {"name": "old-deleted", "region": "us-east-1", "version": "1.34", "deletedAt": expired_ts, "deletedBy": "aws-console"},
        }

        fake_state_mgr = MagicMock()
        fake_state_mgr.list_user_clusters.return_value = ["recent-deleted", "old-deleted"]
        fake_state_mgr.get_cluster_state.side_effect = lambda email, cname: {"state": states[cname]}
        fake_state_mgr.delete_cluster_state.return_value = True

        conn = SimpleNamespace(accessKey="AKIA_TEST", secretKey="SECRET", region="us-east-1")
        with patch.object(backend_main.boto3, "client", return_value=fake_eks), patch.object(
            backend_main, "state_manager", fake_state_mgr
        ):
            clusters = backend_main._list_clusters_sync(conn, "user@tesserak.dev", account_id="123456789012")

        self.assertEqual([c.name for c in clusters], ["recent-deleted"])
        fake_state_mgr.delete_cluster_state.assert_called_once_with("user@tesserak.dev", "old-deleted")

    def test_merge_nodes_and_pods_computes_allocations_and_preserves_metadata(self):
        ec2_nodes = [
            {
                "instanceId": "i-09a08a90e099320ec",
                "name": "worker-1",
                "nodegroupName": "default-ng",
                "instanceType": "t3.large",
                "capacityType": "ON_DEMAND",
                "availabilityZone": "us-east-1a",
                "subnetId": "subnet-abc",
                "amiId": "ami-012345",
                "privateIpAddress": "10.42.13.13",
                "state": "running",
            }
        ]
        k8s_nodes_map = {
            "ip-10-42-13-13.ec2.internal": {
                "apiVersion": "v1",
                "kind": "Node",
                "metadata": {
                    "name": "ip-10-42-13-13.ec2.internal",
                    "creationTimestamp": "2026-11-21T05:05:00Z",
                    "labels": {"eks.amazonaws.com/nodegroup": "default-ng"},
                    "annotations": {"node.alpha.kubernetes.io/ttl": "0"},
                },
                "spec": {"providerID": "aws:///us-east-1a/i-09a08a90e099320ec", "taints": []},
                "status": {
                    "capacity": {"cpu": "2", "memory": "7978652Ki", "pods": "35", "ephemeral-storage": "20Gi"},
                    "allocatable": {"cpu": "1930m", "memory": "7240304Ki", "pods": "35", "ephemeral-storage": "18Gi"},
                    "conditions": [{"type": "Ready", "status": "True", "message": "kubelet is posting ready status"}],
                    "nodeInfo": {
                        "kernelVersion": "6.12.115-140.210.amzn2023.x86_64",
                        "osImage": "Amazon Linux 2023",
                        "operatingSystem": "linux",
                        "architecture": "amd64",
                        "containerRuntimeVersion": "containerd://2.1.7",
                        "kubeletVersion": "v1.33.13-eks",
                    },
                    "addresses": [{"type": "InternalIP", "address": "10.42.13.13"}],
                },
            }
        }
        raw_pod = {
            "metadata": {
                "name": "demo-app-pod-1",
                "namespace": "default",
                "creationTimestamp": "2026-11-26T01:00:00Z",
            },
            "spec": {
                "nodeName": "ip-10-42-13-13.ec2.internal",
                "containers": [
                    {"name": "demo-app", "image": "nginx:1.26.1", "resources": {"requests": {"cpu": "250m", "memory": "256Mi"}}}
                ],
            },
            "status": {
                "phase": "Running",
                "podIP": "10.42.13.45",
                "hostIP": "10.42.13.13",
                "containerStatuses": [{"ready": True, "restartCount": 0, "state": {"running": {}}}],
            },
        }
        pods = [backend_main._extract_pod_summary(raw_pod)]
        merged = backend_main._merge_nodes_and_compute_allocations(ec2_nodes, k8s_nodes_map, pods)

        self.assertEqual(len(merged), 1)
        node = merged[0]
        self.assertEqual(node["nodeName"], "ip-10-42-13-13.ec2.internal")
        self.assertEqual(node["k8sStatus"], "Ready")
        self.assertEqual(node["allocation"]["cpu"]["systemReservedMillicores"], 70)
        self.assertEqual(node["allocation"]["cpu"]["workloadReservedMillicores"], 250)
        self.assertEqual(node["allocation"]["pods"]["used"], 1)
        self.assertEqual(node["allocation"]["pods"]["available"], 34)
        self.assertEqual(pods[0]["podIp"], "10.42.13.45")
        self.assertEqual(pods[0]["status"], "Running")

    def test_cleanup_pipeline_deployments_deletes_manifests_and_skips_idle(self):
        idle = {
            "id": "pip-idle",
            "lastRunNumber": 0,
            "stages": [],
            "targetCluster": "ctx:kind-dev",
            "namespace": "default",
            "repositoryUrl": "https://github.com/org/repo.git",
        }
        idle_res = pipelines_service.cleanup_pipeline_deployments_sync(idle, None, None)
        self.assertFalse(idle_res["attempted"])
        self.assertTrue(idle_res["cleaned"])

        deployed = {
            "id": "pip-1",
            "lastRunNumber": 2,
            "stages": [
                {
                    "name": "Deploy to Cluster",
                    "status": "Succeeded",
                    "log": "deployment.apps/demo-app-deployment created\nservice/demo-app-svc configured",
                }
            ],
            "targetCluster": "ctx:kind-dev",
            "namespace": "default",
            "repositoryUrl": "https://github.com/org/repo.git",
            "branch": "main",
            "manifestPath": ".",
        }
        cmds = []

        def fake_run(cmd, cwd=None, env=None, timeout=120):
            cmds.append(cmd)
            if cmd[:2] == ["git", "clone"]:
                Path(cmd[-1]).mkdir(parents=True, exist_ok=True)
                return 0, "cloned", 0.2
            if "delete" in cmd:
                return 0, 'deployment.apps "demo-app-deployment" deleted\nservice "demo-app-svc" deleted', 0.4
            return 0, "", 0.1

        with patch.object(pipelines_service, "_run_cmd", side_effect=fake_run):
            res = pipelines_service.cleanup_pipeline_deployments_sync(deployed, None, None)

        self.assertTrue(res["attempted"])
        self.assertTrue(res["cleaned"])
        self.assertEqual(
            res["deletedResources"],
            ['deployment.apps "demo-app-deployment" deleted', 'service "demo-app-svc" deleted'],
        )
        self.assertTrue(any("delete" in c and "--ignore-not-found=true" in c for c in cmds))

    def test_ec2_instance_types_filter_by_ami_and_use_cache(self):
        raw_catalog = [
            {
                "InstanceType": "t3.medium",
                "VCpuInfo": {"DefaultVCpus": 2},
                "MemoryInfo": {"SizeInMiB": 4096},
                "ProcessorInfo": {"SupportedArchitectures": ["x86_64"]},
                "CurrentGeneration": True,
                "FreeTierEligible": False,
                "BareMetal": False,
            },
            {
                "InstanceType": "t4g.medium",
                "VCpuInfo": {"DefaultVCpus": 2},
                "MemoryInfo": {"SizeInMiB": 4096},
                "ProcessorInfo": {"SupportedArchitectures": ["arm64"]},
                "CurrentGeneration": True,
                "FreeTierEligible": True,
                "BareMetal": False,
            },
            {
                "InstanceType": "g5.xlarge",
                "VCpuInfo": {"DefaultVCpus": 4},
                "MemoryInfo": {"SizeInMiB": 16384},
                "ProcessorInfo": {"SupportedArchitectures": ["x86_64"]},
                "GpuInfo": {"Gpus": [{"Manufacturer": "NVIDIA", "Name": "A10G", "Count": 1}]},
                "CurrentGeneration": True,
                "BareMetal": False,
            },
            {
                "InstanceType": "g5g.xlarge",
                "VCpuInfo": {"DefaultVCpus": 4},
                "MemoryInfo": {"SizeInMiB": 8192},
                "ProcessorInfo": {"SupportedArchitectures": ["arm64"]},
                "GpuInfo": {"Gpus": [{"Manufacturer": "NVIDIA", "Name": "T4G", "Count": 1}]},
                "CurrentGeneration": True,
                "BareMetal": False,
            },
            {
                "InstanceType": "inf2.xlarge",
                "VCpuInfo": {"DefaultVCpus": 4},
                "MemoryInfo": {"SizeInMiB": 16384},
                "ProcessorInfo": {"SupportedArchitectures": ["x86_64"]},
                "NeuronInfo": {"NeuronDevices": [{"Name": "Inferentia2", "Count": 1}]},
                "CurrentGeneration": True,
                "BareMetal": False,
            },
        ]
        serialized = backend_main._sort_instance_types(
            [backend_main._serialize_ec2_instance_type(x) for x in raw_catalog]
        )

        self.assertEqual(
            [t["instanceType"] for t in backend_main._filter_instance_types_for_ami(serialized, "amazon-linux-2023/x86_64/standard")],
            ["t3.medium"],
        )
        self.assertEqual(
            [t["instanceType"] for t in backend_main._filter_instance_types_for_ami(serialized, "amazon-linux-2023/arm64/standard")],
            ["t4g.medium"],
        )
        self.assertEqual(
            [t["instanceType"] for t in backend_main._filter_instance_types_for_ami(serialized, "amazon-linux-2023/x86_64/nvidia")],
            ["g5.xlarge"],
        )
        self.assertEqual(
            [t["instanceType"] for t in backend_main._filter_instance_types_for_ami(serialized, "amazon-linux-2023/arm64/nvidia")],
            ["g5g.xlarge"],
        )
        self.assertEqual(
            [t["instanceType"] for t in backend_main._filter_instance_types_for_ami(serialized, "amazon-linux-2023/x86_64/neuron")],
            ["inf2.xlarge"],
        )

        # Verify cache avoids repeated AWS API pagination calls
        fake_paginator = MagicMock()
        fake_paginator.paginate.return_value = [{"InstanceTypes": raw_catalog}]
        fake_ec2 = MagicMock()
        fake_ec2.get_paginator.return_value = fake_paginator
        conn = SimpleNamespace(accessKey="AKIA_TEST", secretKey="SECRET", region="us-west-2")

        backend_main._EKS_META_CACHE.pop("ec2_instance_types:us-west-2", None)
        with patch.object(backend_main.boto3, "client", return_value=fake_ec2), patch.object(
            backend_main, "get_db", side_effect=RuntimeError("skip db in unit test")
        ):
            cat1, src1 = backend_main._load_ec2_catalog_sync(conn, "us-west-2", refresh=True)
            cat2, src2 = backend_main._load_ec2_catalog_sync(conn, "us-west-2", refresh=False)

        self.assertEqual(len(cat1), 5)
        self.assertEqual(src1, "aws-live")
        self.assertEqual(src2, "memory-cache")
        self.assertEqual(fake_ec2.get_paginator.call_count, 1)

    def test_account_scoped_connector_lookup_and_platform_catalog_fallback(self):
        import os

        mgr = backend_main.connection_manager
        conn_dev = backend_main.Connection(
            id="aws_dev",
            accessKey="AKIADEV",
            secretKey="SECDEV",
            region="us-east-1",
            accountName="Dev",
            type="aws",
            status="connected",
            createdAt="2026-11-26T00:00:00",
            createdBy="user@tesserak.dev",
            lastUpdated="2026-11-26T01:00:00",
        )
        conn_prod = backend_main.Connection(
            id="aws_prod",
            accessKey="AKIAPROD",
            secretKey="SECPROD",
            region="us-west-2",
            accountName="Prod",
            type="aws",
            status="connected",
            createdAt="2026-11-26T00:00:00",
            createdBy="user@tesserak.dev",
            lastUpdated="2026-11-26T02:00:00",
        )

        async def fake_test_conn(conn, use_cache=False):
            if conn.accessKey == "AKIADEV":
                return True, "ok", "111111111111"
            if conn.accessKey == "AKIAPROD":
                return True, "ok", "222222222222"
            return False, "bad", None

        async def _run():
            with patch.object(mgr, "list_connections", return_value=[conn_prod, conn_dev]), patch.object(
                mgr, "test_connection", side_effect=fake_test_conn
            ):
                matched_dev = await mgr.get_connection_for_account("user@tesserak.dev", "111111111111")
                matched_prod = await mgr.get_connection_for_account("user@tesserak.dev", "222222222222")
                missing = await mgr.get_connection_for_account("user@tesserak.dev", "999999999999")
                self.assertEqual(matched_dev.id, "aws_dev")
                self.assertEqual(matched_prod.id, "aws_prod")
                self.assertIsNone(missing)

            with patch.object(mgr, "list_connections", return_value=[]), patch.dict(
                os.environ,
                {
                    "TESSERAK_CATALOG_AWS_ACCESS_KEY_ID": "AKIACATALOG",
                    "TESSERAK_CATALOG_AWS_SECRET_ACCESS_KEY": "SECCATALOG",
                    "TESSERAK_CATALOG_AWS_REGION": "us-east-1",
                },
            ):
                cat_conn = await mgr.get_catalog_connection("user@tesserak.dev", None)
                self.assertIsNotNone(cat_conn)
                self.assertEqual(cat_conn.id, "platform_catalog")
                self.assertEqual(cat_conn.accessKey, "AKIACATALOG")

        import asyncio
        asyncio.run(_run())

    def test_extract_pod_summary_enrichment_and_pod_actions(self):
        from fastapi import HTTPException

        _extract_pod_summary = backend_main._extract_pod_summary
        _kubectl_pod_action_sync = backend_main._kubectl_pod_action_sync
        _validate_k8s_name = backend_main._validate_k8s_name

        pod = {
            "kind": "Pod",
            "apiVersion": "v1",
            "metadata": {
                "name": "ebs-csi-controller-7bbcfd96bb-gnkgh",
                "namespace": "kube-system",
                "uid": "pod-uid-123",
                "creationTimestamp": "2026-11-27T11:30:00Z",
                "managedFields": [{"manager": "kube-scheduler"}],
                "ownerReferences": [
                    {"kind": "ReplicaSet", "name": "ebs-csi-controller-7bbcfd96bb", "uid": "rs-1"}
                ],
                "labels": {"app": "ebs-csi-controller"},
            },
            "spec": {
                "nodeName": "ip-10-42-31-199.ec2.internal",
                "serviceAccountName": "ebs-csi-controller-sa",
                "restartPolicy": "Always",
                "volumes": [{"name": "socket-dir", "emptyDir": {}}],
                "containers": [
                    {
                        "name": "ebs-plugin",
                        "image": "public.ecr.aws/ebs-csi-driver/aws-ebs-csi-driver:v1.30.0",
                        "imagePullPolicy": "IfNotPresent",
                        "ports": [{"containerPort": 9808, "protocol": "TCP", "name": "healthz"}],
                        "resources": {"requests": {"cpu": "10m", "memory": "40Mi"}},
                        "volumeMounts": [{"name": "socket-dir", "mountPath": "/var/lib/csi/sockets/pluginproxy/"}],
                        "env": [{"name": "CSI_ENDPOINT", "value": "unix:///csi/csi.sock"}],
                    }
                ],
            },
            "status": {
                "phase": "Running",
                "podIP": "10.42.18.2",
                "hostIP": "10.42.31.199",
                "qosClass": "Burstable",
                "conditions": [
                    {"type": "Ready", "status": "True", "lastTransitionTime": "2026-11-27T11:31:00Z"}
                ],
                "containerStatuses": [
                    {
                        "name": "ebs-plugin",
                        "ready": True,
                        "started": True,
                        "restartCount": 1,
                        "containerID": "containerd://abc",
                        "state": {"running": {"startedAt": "2026-11-27T11:31:00Z"}},
                    }
                ],
            },
        }

        summary = _extract_pod_summary(pod)
        self.assertEqual(summary["controlledBy"][0]["kind"], "ReplicaSet")
        self.assertEqual(summary["lastTransitionTime"], "2026-11-27T11:31:00Z")
        self.assertEqual(summary["qosClass"], "Burstable")
        self.assertEqual(summary["serviceAccountName"], "ebs-csi-controller-sa")
        self.assertEqual(summary["containers"][0]["name"], "ebs-plugin")
        self.assertEqual(summary["containers"][0]["state"]["status"], "Running")
        self.assertEqual(summary["containers"][0]["envNames"], ["CSI_ENDPOINT"])
        self.assertNotIn("managedFields", summary["raw"]["metadata"])

        with self.assertRaises(HTTPException):
            _validate_k8s_name("bad pod!", "pod name")

        conn = SimpleNamespace(accessKey="AKIA1", secretKey="SEC1", region="us-east-1", accountId="111122223333")
        fake_eks = MagicMock()
        fake_eks.describe_cluster.return_value = {
            "cluster": {
                "endpoint": "https://example.eks.amazonaws.com",
                "certificateAuthority": {"data": "Q0E="},
            }
        }
        fake_proc = SimpleNamespace(returncode=0, stdout='pod "ebs-csi-controller-7bbcfd96bb-gnkgh" deleted', stderr="")
        with patch.object(backend_main.boto3, "client", return_value=fake_eks), patch.object(
            backend_main.subprocess, "run", return_value=fake_proc
        ) as run_mock:
            restart_res = _kubectl_pod_action_sync(conn, "tesserak", "kube-system", "ebs-csi-controller-7bbcfd96bb-gnkgh", "restart")
            self.assertEqual(restart_res["status"], "restarting")
            delete_res = _kubectl_pod_action_sync(conn, "tesserak", "kube-system", "ebs-csi-controller-7bbcfd96bb-gnkgh", "delete", force=True)
            self.assertEqual(delete_res["status"], "deleting")
            self.assertIn("--force", run_mock.call_args_list[1][0][0])

    def test_cluster_sync_includes_nodegroups_and_helm_addon_installs_cleanly(self):
        from state_management import StateData

        sd = StateData()
        base = {
            "name": "tesserak",
            "status": "CREATING",
            "version": "1.37",
            "endpoint": None,
            "nodeGroups": [{"nodegroupName": "tesserak-ng"}],
        }
        updated = sd.record_state_change(
            base,
            "sync",
            {
                "aws_state": {
                    "status": "ACTIVE",
                    "version": "1.37",
                    "endpoint": "https://eks.example.com",
                    "nodeGroups": [{"nodegroupName": "tesserak-ng"}],
                }
            },
        )
        self.assertEqual(updated["status"], "ACTIVE")
        self.assertEqual(updated["endpoint"], "https://eks.example.com")
        self.assertEqual(len(updated["nodeGroups"]), 1)

        fake_conn = SimpleNamespace(accessKey="AKIA1", secretKey="SEC1", region="us-east-1", accountId="111122223333")
        fake_eks = MagicMock()
        fake_eks.list_clusters.return_value = {"clusters": ["tesserak", "aws-only-cluster"]}
        fake_eks.describe_cluster.side_effect = lambda name: {
            "cluster": {
                "name": name,
                "status": "ACTIVE",
                "version": "1.37",
                "endpoint": "https://eks.example.com",
                "arn": f"arn:aws:eks:us-east-1:111122223333:cluster/{name}",
            }
        }
        fake_eks.list_nodegroups.side_effect = lambda clusterName: {
            "nodegroups": ["tesserak-ng"] if clusterName == "tesserak" else []
        }

        fake_sts = MagicMock()
        fake_sts.get_caller_identity.return_value = {"Account": "111122223333"}

        def client_factory(service_name, **kwargs):
            return fake_eks if service_name == "eks" else fake_sts

        with patch.object(backend_main.boto3, "client", side_effect=client_factory), patch.object(
            backend_main.state_manager, "list_user_clusters", return_value=["tesserak"]
        ), patch.object(
            backend_main.state_manager,
            "get_cluster_state",
            side_effect=lambda email, cname: (
                {"state": updated, "last_updated": "2026-11-27T14:00:00"}
                if cname == "tesserak"
                else None
            ),
        ), patch.object(
            backend_main.state_manager,
            "compare_with_aws_state",
            side_effect=lambda email, cname, aws_st: (
                {"status": "in_sync", "differences": []}
                if len(aws_st.get("nodeGroups") or []) == 1
                else {"status": "differences_found", "differences": ["node_group_count_mismatch"]}
            ),
        ):
            clusters = backend_main._list_clusters_sync(fake_conn, "user@tesserak.dev")
            by_name = {c.name: c for c in clusters}
            self.assertEqual(by_name["tesserak"].stateStatus, "synced")
            self.assertEqual(by_name["tesserak"].stateDifferences, [])
            self.assertEqual(by_name["aws-only-cluster"].stateStatus, "missing_local")

        # Verify Helm community addon installer executes isolated repo add/update & upgrade --install
        addon = backend_main.AddonModel(id="ingress-nginx", name="Ingress NGINX", type="community", version="4.12.1")
        helm_calls = []

        def fake_helm_run(cmd, capture_output=True, text=True, timeout=180, env=None, check=False):
            helm_calls.append((cmd, env))
            if len(cmd) >= 2 and cmd[1] == "status":
                return SimpleNamespace(returncode=1, stdout="", stderr="release: not found")
            if len(cmd) >= 3 and cmd[1] == "get" and cmd[2] == "notes":
                return SimpleNamespace(returncode=0, stdout="Ingress NGINX Ready", stderr="")
            return SimpleNamespace(returncode=0, stdout='Release "ingress-nginx" has been upgraded.', stderr="")

        with patch.object(backend_main, "_resolve_helm_binary", return_value="/opt/homebrew/bin/helm"), patch.object(
            backend_main.subprocess, "run", side_effect=fake_helm_run
        ):
            install_res = backend_main._install_community_addon_sync(
                fake_conn,
                "us-east-1",
                "tesserak",
                addon,
                cluster_info={"endpoint": "https://eks.example.com", "certificateAuthority": {"data": "Q0E="}},
            )
            self.assertEqual(install_res["status"], "installed")
            self.assertEqual(install_res["namespace"], "ingress-nginx")
            self.assertEqual(helm_calls[0][0][:3], ["/opt/homebrew/bin/helm", "repo", "add"])
            upgrade_call = next(c for c in helm_calls if len(c[0]) > 1 and c[0][1] == "upgrade")
            self.assertEqual(upgrade_call[0][:4], ["/opt/homebrew/bin/helm", "upgrade", "--install", "ingress-nginx"])
            self.assertIn("HELM_CACHE_HOME", upgrade_call[1])

    def test_cpa_target_custom_values_and_pending_helm_recovery(self):
        fake_conn = SimpleNamespace(accessKey="AKIA1", secretKey="SEC1", region="us-east-1", accountId="111122223333")
        cluster_info = {"endpoint": "https://eks.example.com", "certificateAuthority": {"data": "Q0E="}}

        # 1. Cluster Proportional Autoscaler includes default options.target=deployment/coredns
        cpa_addon = backend_main.AddonModel(
            id="cluster-proportional-autoscaler",
            name="Cluster Proportional Autoscaler",
            type="community",
        )
        cpa_cmds = []

        def fake_cpa_run(cmd, capture_output=True, text=True, timeout=180, env=None, check=False):
            cpa_cmds.append(cmd)
            if len(cmd) >= 2 and cmd[1] == "status":
                return SimpleNamespace(returncode=1, stdout="", stderr="release: not found")
            if len(cmd) >= 3 and cmd[1] == "get" and cmd[2] == "notes":
                return SimpleNamespace(returncode=0, stdout="CPA Notes", stderr="")
            return SimpleNamespace(returncode=0, stdout="Release \"cluster-proportional-autoscaler\" deployed", stderr="")

        with patch.object(backend_main, "_resolve_helm_binary", return_value="/opt/homebrew/bin/helm"), patch.object(
            backend_main.subprocess, "run", side_effect=fake_cpa_run
        ):
            res = backend_main._install_community_addon_sync(
                fake_conn, "us-east-1", "tesserak", cpa_addon, cluster_info=cluster_info
            )
            self.assertEqual(res["status"], "installed")
            upgrade_cmd = next(c for c in cpa_cmds if "upgrade" in c)
            self.assertIn("options.target=deployment/coredns", upgrade_cmd)
            self.assertEqual(res["notes"], "CPA Notes")

        # 2. Custom values.yaml + recovery from stuck pending-install release
        argo_addon = backend_main.AddonModel(
            id="argo-cd",
            name="Argo CD",
            type="community",
            valuesYaml="server:\n  ingress:\n    enabled: true\n",
        )
        argo_cmds = []
        captured_values = []

        def fake_argo_run(cmd, capture_output=True, text=True, timeout=180, env=None, check=False):
            argo_cmds.append(cmd)
            if len(cmd) >= 2 and cmd[1] == "status":
                return SimpleNamespace(returncode=0, stdout='{"info": {"status": "pending-install"}}', stderr="")
            if len(cmd) >= 2 and cmd[1] == "uninstall":
                return SimpleNamespace(returncode=0, stdout="release uninstalled", stderr="")
            if "--values" in cmd:
                val_path = cmd[cmd.index("--values") + 1]
                with open(val_path, "r") as fh:
                    captured_values.append(fh.read())
            if len(cmd) >= 3 and cmd[1] == "get" and cmd[2] == "notes":
                return SimpleNamespace(returncode=0, stdout="Argo CD URL ready", stderr="")
            return SimpleNamespace(returncode=0, stdout="Release \"argocd\" deployed", stderr="")

        with patch.object(backend_main, "_resolve_helm_binary", return_value="/opt/homebrew/bin/helm"), patch.object(
            backend_main.subprocess, "run", side_effect=fake_argo_run
        ):
            res2 = backend_main._install_community_addon_sync(
                fake_conn, "us-east-1", "tesserak", argo_addon, cluster_info=cluster_info
            )
            self.assertEqual(res2["status"], "installed")
            self.assertTrue(any("uninstall" in c for c in argo_cmds))
            self.assertEqual(len(captured_values), 1)
            self.assertIn("enabled: true", captured_values[0])
            self.assertIn("Custom values.yaml", res2["logs"]) if "Custom" in res2["logs"] else self.assertIn("custom values", res2["logs"])

    def test_fetch_pod_events_sync_and_uninstall_addon(self):
        fake_conn = SimpleNamespace(accessKey="AKIA1", secretKey="SEC1", region="us-east-1", accountId="111122223333")
        fake_eks = MagicMock()
        fake_eks.describe_cluster.return_value = {
            "cluster": {
                "name": "tesserak",
                "status": "ACTIVE",
                "endpoint": "https://eks.example.com",
                "certificateAuthority": {"data": "Q0E="},
            }
        }

        events_payload = {
            "items": [
                {
                    "type": "Normal",
                    "reason": "Scheduled",
                    "message": "Successfully assigned default/pod-1 to node-1",
                    "count": 1,
                    "source": {"component": "default-scheduler"},
                    "involvedObject": {"kind": "Pod", "name": "pod-1"},
                    "lastTimestamp": "2026-11-27T10:00:00Z",
                },
                {
                    "type": "Warning",
                    "reason": "BackOff",
                    "message": "Back-off restarting failed container",
                    "count": 3,
                    "source": {"component": "kubelet", "host": "node-1"},
                    "involvedObject": {"kind": "Pod", "name": "pod-1"},
                    "lastTimestamp": "2026-11-27T10:05:00Z",
                },
            ]
        }
        pod_payload = {
            "metadata": {"name": "pod-1", "namespace": "default"},
            "status": {"phase": "Running", "containerStatuses": []},
            "spec": {"containers": [{"name": "app", "image": "nginx:latest"}]},
        }

        def fake_kubectl_run(cmd, capture_output=True, text=True, timeout=15, env=None, check=False):
            if "events" in cmd:
                return SimpleNamespace(returncode=0, stdout=json.dumps(events_payload), stderr="")
            if "pod" in cmd:
                return SimpleNamespace(returncode=0, stdout=json.dumps(pod_payload), stderr="")
            if "uninstall" in cmd:
                return SimpleNamespace(returncode=0, stdout='release "argocd" uninstalled', stderr="")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with patch.object(backend_main.boto3, "client", return_value=fake_eks), patch.object(
            backend_main.subprocess, "run", side_effect=fake_kubectl_run
        ):
            ev_res = backend_main._fetch_pod_events_sync(fake_conn, "tesserak", "default", "pod-1")
            self.assertEqual(len(ev_res["events"]), 2)
            self.assertEqual(ev_res["events"][0]["reason"], "BackOff")
            self.assertEqual(ev_res["events"][0]["count"], 3)
            self.assertEqual(ev_res["pod"]["name"], "pod-1")

        stored_wrapper = {
            "state": {
                "name": "tesserak",
                "communityAddons": [
                    {"id": "argo-cd", "releaseName": "argocd", "namespace": "argocd", "status": "installed"},
                    {"id": "metrics-server", "releaseName": "metrics-server", "namespace": "kube-system", "status": "installed"},
                ],
                "addons": [
                    {"id": "argo-cd", "type": "community"},
                    {"id": "vpc-cni", "type": "aws"},
                ],
            }
        }
        saved_states = []
        with patch.object(backend_main.boto3, "client", return_value=fake_eks), patch.object(
            backend_main, "_resolve_helm_binary", return_value="/opt/homebrew/bin/helm"
        ), patch.object(backend_main.subprocess, "run", side_effect=fake_kubectl_run), patch.object(
            backend_main.state_manager, "get_cluster_state", return_value=stored_wrapper
        ), patch.object(
            backend_main.state_manager, "save_cluster_state", side_effect=lambda email, cname, st: saved_states.append(st)
        ):
            un_res = backend_main._uninstall_community_addon_sync(fake_conn, "user@tesserak.dev", "tesserak", "argo-cd")
            self.assertEqual(un_res["status"], "uninstalled")
            self.assertIn("$ helm uninstall argocd -n argocd", un_res["logs"])
            self.assertIn('release "argocd" uninstalled', un_res["logs"])
            self.assertEqual(len(saved_states), 1)
            self.assertEqual([a["id"] for a in saved_states[0]["communityAddons"]], ["metrics-server"])
            self.assertEqual([a["id"] for a in saved_states[0]["addons"]], ["vpc-cni"])

        # After uninstall removes communityAddons entry, /details still recovers uninstall logs from history
        with patch.object(backend_main.boto3, "client", return_value=fake_eks), patch.object(
            backend_main, "_resolve_helm_binary", return_value="/opt/homebrew/bin/helm"
        ), patch.object(backend_main.subprocess, "run", side_effect=fake_kubectl_run), patch.object(
            backend_main.state_manager, "get_cluster_state", return_value={"state": saved_states[0]}
        ):
            det_res = backend_main._fetch_community_addon_details_sync(fake_conn, "user@tesserak.dev", "tesserak", "argo-cd")
            self.assertIn("$ helm uninstall argocd -n argocd", det_res["logs"])
            self.assertIn('release "argocd" uninstalled', det_res["logs"])

    def test_community_addon_details_filters_resources_and_strips_values_header(self):
        fake_conn = SimpleNamespace(accessKey="AKIA1", secretKey="SEC1", region="us-east-1", accountId="111122223333")
        fake_eks = MagicMock()
        fake_eks.describe_cluster.return_value = {
            "cluster": {
                "name": "replit-eks",
                "status": "ACTIVE",
                "endpoint": "https://eks.example.com",
                "certificateAuthority": {"data": "Q0E="},
            }
        }

        k8s_items = {
            "items": [
                {
                    "kind": "Pod",
                    "metadata": {
                        "name": "aws-load-balancer-controller-76dcd88787-2xp2t",
                        "namespace": "kube-system",
                        "labels": {
                            "app.kubernetes.io/name": "aws-load-balancer-controller",
                            "app.kubernetes.io/instance": "aws-load-balancer-controller",
                        },
                    },
                    "spec": {"nodeName": "ip-10-0-1-10", "containers": [{"name": "ctrl", "image": "lbc:v2.11.0"}]},
                    "status": {"phase": "Running", "podIP": "10.42.1.10", "containerStatuses": [{"ready": True}]},
                },
                {
                    "kind": "Pod",
                    "metadata": {
                        "name": "aws-node-x123",
                        "namespace": "kube-system",
                        "labels": {"k8s-app": "aws-node"},
                    },
                    "spec": {"nodeName": "ip-10-0-1-10", "containers": [{"name": "aws-node", "image": "cni:latest"}]},
                    "status": {"phase": "Running", "podIP": "10.42.1.11", "containerStatuses": [{"ready": True}]},
                },
                {
                    "kind": "Pod",
                    "metadata": {
                        "name": "coredns-5d9b55bc77-6562h",
                        "namespace": "kube-system",
                        "labels": {"k8s-app": "kube-dns"},
                    },
                    "spec": {"nodeName": "ip-10-0-1-10", "containers": [{"name": "coredns", "image": "coredns:latest"}]},
                    "status": {"phase": "Running", "podIP": "10.42.1.12", "containerStatuses": [{"ready": True}]},
                },
                {
                    "kind": "Service",
                    "metadata": {
                        "name": "aws-load-balancer-webhook-service",
                        "namespace": "kube-system",
                        "labels": {"app.kubernetes.io/instance": "aws-load-balancer-controller"},
                    },
                    "spec": {"type": "ClusterIP", "clusterIP": "172.20.138.52", "ports": [{"port": 443, "protocol": "TCP"}]},
                },
                {
                    "kind": "Service",
                    "metadata": {
                        "name": "kube-dns",
                        "namespace": "kube-system",
                        "labels": {"k8s-app": "kube-dns"},
                    },
                    "spec": {"type": "ClusterIP", "clusterIP": "172.20.0.10", "ports": [{"port": 53, "protocol": "UDP"}]},
                },
                {
                    "kind": "Event",
                    "type": "Normal",
                    "reason": "Started",
                    "message": "Started container controller",
                    "involvedObject": {"kind": "Pod", "name": "aws-load-balancer-controller-76dcd88787-2xp2t"},
                    "lastTimestamp": "2026-11-28T10:00:00Z",
                },
                {
                    "kind": "Event",
                    "type": "Normal",
                    "reason": "Pulled",
                    "message": "Pulled kube-proxy image",
                    "involvedObject": {"kind": "Pod", "name": "kube-proxy-x9q42"},
                    "lastTimestamp": "2026-11-28T10:01:00Z",
                },
            ]
        }

        call_counts = {"cmd": 0}

        def fake_run(cmd, capture_output=True, text=True, timeout=15, env=None, check=False):
            call_counts["cmd"] += 1
            if "status" in cmd:
                return SimpleNamespace(
                    returncode=0,
                    stdout=json.dumps({"info": {"status": "deployed", "notes": "AWS Load Balancer Controller installed!"}}),
                    stderr="",
                )
            if "values" in cmd:
                return SimpleNamespace(
                    returncode=0,
                    stdout="USER-SUPPLIED VALUES:\nclusterName: replit-eks\nregion: us-east-1\n",
                    stderr="",
                )
            if "pods,svc,ingress,events" in cmd:
                return SimpleNamespace(returncode=0, stdout=json.dumps(k8s_items), stderr="")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with patch.object(backend_main.boto3, "client", return_value=fake_eks), patch.object(
            backend_main, "_resolve_helm_binary", return_value="/opt/homebrew/bin/helm"
        ), patch.object(backend_main.subprocess, "run", side_effect=fake_run), patch.object(
            backend_main.state_manager, "get_cluster_state", return_value=None
        ):
            res = backend_main._fetch_community_addon_details_sync(
                fake_conn,
                "user@tesserak.dev",
                "replit-eks",
                "aws-load-balancer-controller",
                namespace_override="kube-system",
                release_override="aws-load-balancer-controller",
            )
            self.assertEqual([p["name"] for p in res["resources"]["pods"]], ["aws-load-balancer-controller-76dcd88787-2xp2t"])
            self.assertEqual([s["name"] for s in res["resources"]["services"]], ["aws-load-balancer-webhook-service"])
            self.assertEqual([e["reason"] for e in res["events"]], ["Started"])
            self.assertEqual(res["valuesYaml"], "clusterName: replit-eks\nregion: us-east-1")
            first_count = call_counts["cmd"]
            self.assertEqual(first_count, 3)

            # Cached repeat open skips extra subprocess calls unless refresh=True
            res_cached = backend_main._fetch_community_addon_details_sync(
                fake_conn,
                "user@tesserak.dev",
                "replit-eks",
                "aws-load-balancer-controller",
                namespace_override="kube-system",
                release_override="aws-load-balancer-controller",
            )
            self.assertEqual(call_counts["cmd"], first_count)
            self.assertEqual(res_cached["notes"], "AWS Load Balancer Controller installed!")

            backend_main._fetch_community_addon_details_sync(
                fake_conn,
                "user@tesserak.dev",
                "replit-eks",
                "aws-load-balancer-controller",
                namespace_override="kube-system",
                release_override="aws-load-balancer-controller",
                refresh=True,
            )
            self.assertEqual(call_counts["cmd"], 6)


if __name__ == "__main__":
    unittest.main()
