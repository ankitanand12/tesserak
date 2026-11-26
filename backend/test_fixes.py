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


if __name__ == "__main__":
    unittest.main()
