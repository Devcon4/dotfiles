type ToolCallEvent = { toolName: string; input?: Record<string, unknown> };
type GuardResult =
	| { block: true; reason: string }
	| { input: Record<string, unknown> }
	| undefined;
type Host = {
	on(
		event: "tool_call",
		fn: (event: ToolCallEvent) => Promise<GuardResult>,
	): void;
};

/**
 * Blocks agent access to cluster-admin credentials and cluster write operations.
 * Agents get readonly ~/.kube/config (context strix-readonly) and nothing else.
 *
 * Enforcement is two-layer:
 *  1. deny: admin-credential references anywhere; mutating kubectl/helm/flux
 *     verbs and talosctl on command surfaces.
 *  2. rewrite: kube CLI invocations in bash/hub-start get KUBECONFIG forced to
 *     the readonly config, because agent shells inherit the interactive zsh
 *     environment where KUBECONFIG points at the admin kubeconfig. An explicit
 *     KUBECONFIG (input.env or inline VAR=) is respected -- it already passed
 *     the credential deny-list, so it's a non-strix config (kind, k3d, ...).
 *
 * Dev escape hatch: run the command yourself, or remove/rename this file.
 */

// Checked against the full JSON-stringified input of EVERY tool call:
// credentials must not be used, read, copied, or referenced anywhere.
const CRED_PATTERNS: { re: RegExp; why: string }[] = [
	{
		re: /strix-admin/i,
		why: "references the admin kubeconfig (~/.kube/strix-admin.yml)",
	},
	{
		re: /(?:\/mnt\/c|C:)[\\/]+Users[\\/]+[^\\/"']+[\\/]+\.kube[\\/]+config/i,
		why: "the Windows-side kubeconfig (Headlamp's) is cluster-admin",
	},
];

// Checked only against command-bearing fields (bash.command, eval.code,
// hub.application+args) so repo file edits mentioning these words stay legal.
const CMD_PATTERNS: { re: RegExp; why: string }[] = [
	{
		re: /\btalosctl\b/i,
		why: "talosctl is off-limits for agents — the talosconfig is os:admin and mistakes are cluster-fatal",
	},
	{
		re: /\bkubectl(?:\.exe)?\b[^\n;|&]*\s(apply|create|delete|patch|replace|edit|scale|autoscale|rollout|drain|cordon|uncordon|taint|label|annotate|set|exec|cp|attach|debug|expose|run)\b/i,
		why: "mutating kubectl verbs are dev-only",
	},
	{
		re: /\bhelm(?:\.exe)?\b[^\n;|&]*\s(install|upgrade|uninstall|delete|rollback)\b/i,
		why: "mutating helm operations are dev-only",
	},
	{
		re: /\bflux(?:\.exe)?\b[^\n;|&]*\s(reconcile|suspend|resume|create|delete|bootstrap|install|uninstall|push)\b/i,
		why: "mutating flux operations are dev-only",
	},
];

// Kube CLIs whose invocations must run against the readonly kubeconfig.
const KUBE_CLI = /\b(?:kubectl|helm|flux|k9s)(?:\.exe)?\b/i;
const RO_KUBECONFIG = `${process.env.HOME}/.kube/config`;

function commandSurfaces(event: ToolCallEvent): string[] {
	const input = event.input ?? {};
	switch (event.toolName) {
		case "bash":
			return [String(input.command ?? "")];
		case "eval":
			return [String(input.code ?? "")];
		case "hub":
			return [
				[input.application, ...(Array.isArray(input.args) ? input.args : []), input.text]
					.filter(Boolean)
					.join(" "),
			];
		default:
			return [];
	}
}

/**
 * Force the readonly kubeconfig onto a kube CLI invocation unless the call
 * already pins KUBECONFIG itself (tool env or inline assignment).
 */
function forceReadonly(event: ToolCallEvent): GuardResult {
	const input = event.input ?? {};
	if (event.toolName === "bash") {
		const cmd = String(input.command ?? "");
		const env = (input.env ?? {}) as Record<string, unknown>;
		if (KUBE_CLI.test(cmd) && !("KUBECONFIG" in env) && !/\bKUBECONFIG=/.test(cmd)) {
			return { input: { ...input, env: { ...env, KUBECONFIG: RO_KUBECONFIG } } };
		}
	}
	if (event.toolName === "hub" && input.op === "start") {
		const argv = [input.application, ...(Array.isArray(input.args) ? input.args : [])]
			.filter(Boolean)
			.join(" ");
		const env = (input.env ?? {}) as Record<string, unknown>;
		if (KUBE_CLI.test(argv) && !("KUBECONFIG" in env)) {
			return { input: { ...input, env: { ...env, KUBECONFIG: RO_KUBECONFIG } } };
		}
	}
	return undefined;
}

export default function kubeAdminGuard(pi: Host): void {
	pi.on("tool_call", async (event) => {
		const deny = (why: string): GuardResult => ({
			block: true,
			reason:
				`kube-admin-guard: blocked — ${why}. ` +
				"Agents may only use the readonly ~/.kube/config (context strix-readonly) for read operations. " +
				"If this change is needed, print the exact command for the dev to run.",
		});

		const raw = JSON.stringify(event.input ?? {});
		for (const { re, why } of CRED_PATTERNS) {
			if (re.test(raw)) return deny(why);
		}
		for (const surface of commandSurfaces(event)) {
			for (const { re, why } of CMD_PATTERNS) {
				if (re.test(surface)) return deny(why);
			}
		}

		// eval kernels inherit the launch env and can't have it rewritten per
		// call -- route kube CLIs through bash, where readonly is injected.
		if (event.toolName === "eval" && KUBE_CLI.test(String((event.input ?? {}).code ?? ""))) {
			return deny("kube CLIs in eval run with the inherited (admin) environment; use the bash tool instead — it gets the readonly kubeconfig injected");
		}

		return forceReadonly(event);
	});
}
