---
alwaysApply: true
description: Agents must never use cluster-admin credentials; readonly kubeconfig only
---
# Cluster credential policy (strix)

- All Kubernetes access MUST go through the default readonly kubeconfig `~/.kube/config` (context `strix-readonly`, SA `kube-system/dev-readonly`).
- NEVER use, read, copy, or point `KUBECONFIG`/`--kubeconfig` at `~/.kube/strix-admin.yml` or the Windows-side `C:\Users\<win-user>\.kube\config` — both are cluster-admin (`system:masters`). They belong to the dev, not agents.
- NEVER run `talosctl` at all — the talosconfig carries `os:admin`; node resets, upgrades, and machineconfig edits are cluster-fatal. This includes minting kubeconfigs via `talosctl kubeconfig`.
- NEVER run mutating cluster commands: `kubectl apply/create/delete/patch/edit/scale/exec/...`, `helm install/upgrade/uninstall/rollback`, `flux reconcile/suspend/resume/create/delete/bootstrap`. Read-only inspection (`get`, `describe`, `logs`, `top`, `flux get`, `helm list/status`) is allowed.
- If a task needs any of the above, do not work around it: print the exact command and let the dev run it. GitOps changes go through this repo, not the cluster.
