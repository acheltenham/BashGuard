# Sandbox Adapter and Boundary Reporting Design

**Status:** Approved — Slice 1 is the current implementation focus
**Date:** August 22, 2026  
**Phase:** Intentional interruption of Phase 1; precedes Command Resolution Spike 2
**Related:** [Issue #79](https://github.com/acheltenham/BashGuard/issues/79), [Decision 005](../adr/decision-log.md)

## Goal

Let BashGuard report the containment boundary it can detect — and say plainly what that boundary does *not* cover — without BashGuard implementing, orchestrating, or executing through any sandbox.

## Delivery sequence

This design is delivered in bounded slices rather than as one backend-integration feature:

1. **In progress — Slice 1:** define `SandboxAdapter`, implement `NoSandboxAdapter`, and add `bashguard boundary` for the current environment.
2. **Next:** run Command Resolution Spike 2.
3. **Resume Phase 1:** implement the paused split-pane event browser.
4. **Then:** begin the Phase 3 authorization slice.
5. **Later:** implement `AnthropicSandboxRuntimeAdapter`, session-time boundary evidence, and grounded debrief integration.

Slice 1 must not infer a historical session boundary from configuration read at debrief time. Current configuration can describe only the current environment; a future debrief section requires boundary evidence recorded during the session.

## Why this comes before enforcement

["Your agent can run code — what can that code reach?"](https://cheltenham.dev/research/your-agent-can-run-code-what-can-that-code-reach) separates agent security into independent controls rather than one thing called "sandboxing":

| Control | Question | Owner |
|---|---|---|
| Authorization | Should this action run? | BashGuard (Phase 3) |
| Containment | What can it affect if it runs? | Sandbox backend |
| Network policy | Where can it communicate? | Sandbox backend |
| Downstream authorization | What can it do when it gets there? | Not addressed today |
| Observability | Can we reconstruct what happened? | BashGuard (shipped) |

Its central claim — **"Authorization is not containment"** — is the reason this slice exists. BashGuard already owns observability and is closest to owning authorization. It should own neither containment nor network policy.

That leaves a gap nothing currently fills. Sandboxes enforce silently, and Pi does not editorialize about them. Nobody tells the developer what the composite boundary actually is, or where it stops. The article's own conclusion — *"make authority explicit"* — is an unbuilt feature, and it is squarely BashGuard's kind of work: describing recorded and reported evidence without claiming to be the control itself.

## Landscape as of August 2026

Verified against the Pi SDK this repository already depends on (`@earendil-works/pi-coding-agent` 0.84.0):

- Pi ships **no built-in sandbox**, deliberately. `docs/security.md` states that real isolation must come from the operating system, a VM, or a container boundary.
- Pi ships a **first-party sandbox example** at `examples/extensions/sandbox/` (`pi-extension-sandbox`), built on **`@anthropic-ai/sandbox-runtime`** — `sandbox-exec` on macOS, `bubblewrap` on Linux.
- **`pi-sandbox`** (`github.com/carderne/pi-sandbox`, npm 0.6.5) is a separate third-party extension advertising OS-level sandboxing with interactive permission prompts. Its decision surface has not been examined.
- Pi additionally documents **Gondolin** (local micro-VM), **plain Docker**, and **NVIDIA OpenShell** as containerization patterns.

Two findings shape this design:

1. **The first-party sandbox example mediates only `bash` and user `!` commands.** It does not mediate the `read`, `write`, or `edit` tools. A write to `.env` through the `write` tool is not covered by its `filesystem.denyWrite` configuration. Gondolin, by contrast, overrides `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`. This is a capability-authority gap sitting inside a host-isolation boundary, and it is invisible to the user today.
2. **Enforcement rewrites the command.** The example wraps commands through `SandboxManager.wrapWithSandbox(command)` before execution, so the requested command and the executed command differ. This is the same gap the capability matrix records as *Resolved command — Partial*.

## Adapter shape

Issue #79 originally proposed `EnforcementAdapter` with `capabilities()`, `evaluate()`, `execute()`, and `escalate()`. This design deliberately narrows that to two methods:

```text
SandboxAdapter
  describe()   → the boundary in force: isolation kind, filesystem scope,
                 network policy, and which Pi tools the backend mediates
  observe()    → map recorded session evidence to allow / deny / violation
                 decisions, where the backend exposes them
```

`execute()` and `escalate()` are removed. Putting BashGuard on the execution path would make it a sandbox orchestrator: a larger and more fragile product that must track every backend's execution model, and one that implicitly claims to be the single sufficient mechanism — which the article's "combine controls" conclusion rejects. Pi executes, the backend enforces, BashGuard describes and reports.

`describe()` returns a structured boundary record. `observe()` returns decisions correlated to recorded events by `toolCallId` where possible, and returns nothing where the backend exposes no structured decisions. Neither method executes anything, mutates a session, or writes configuration.

## Evidence semantics

The boundary report follows BashGuard's existing vocabulary, and the distinction it draws is the most important part of this design.

- **Reported** — derived from configuration. Finding `.pi/sandbox.json` proves a configuration file exists. It does not prove the extension was loaded, that it was enabled, or that it was active for the session being reported on.
- **Observed** — derived from recorded session events. A recorded tool labelled `bash (sandboxed)`, or a recorded sandbox violation in command output, is observed evidence that the backend was active for that session.
- **Unknown** — neither available.

A configuration-only report must never be presented as an active boundary. This is the same discipline that keeps path overlap from being presented as causality.

### The limit BashGuard cannot cross

BashGuard runs *inside* whatever boundary exists. It therefore cannot fully characterize its own container from within, and it cannot prove the absence of an outer boundary. If Pi is running inside Docker, a VM, or a remote sandbox, BashGuard may see weak hints and may see nothing at all.

So the no-sandbox case reports **"no containment boundary detected"**, never "no containment boundary exists". Any host-isolation hints BashGuard does surface are labelled reported, never observed, and never treated as a complete characterization. The article's own isolation spectrum is a useful frame here precisely because BashGuard can only ever describe the layer it can see.

## Presentation

```text
Boundary

  Isolation      OS-level (sandbox-exec) · reported from .pi/sandbox.json
  Mediated       bash, user ! commands
  Not mediated   read, write, edit
  Filesystem     denyWrite: .env, *.pem, *.key · allowWrite: ., /tmp
  Network        deny by default · 11 domains allowed

Not covered by this boundary

  - file writes through the write and edit tools
  - downstream authority of any credential available to the session
  - any outer container or VM, which BashGuard cannot characterize from inside

Evidence

  reported from configuration; no recorded event confirms the backend
  was active for this session
```

With no backend detected:

```text
Boundary

  Isolation      none detected
  Mediated       nothing
  Filesystem     full user permissions
  Network        unrestricted

  Pi tools run with the permissions of your user account. BashGuard cannot
  detect an outer container or VM from inside the session.
```

Narrow terminals drop the aligned columns before dropping any "not covered" line. Coverage gaps are the point of the report and are the last thing to go.

## CLI surface

### Slice 1

```text
bashguard boundary
```

Reports detectable boundary evidence for the current environment. This needs no session. The first implementation uses `NoSandboxAdapter` and reports that no supported containment boundary was detected without claiming that no outer boundary exists.

Existing commands keep their current output in Slice 1. In particular, `bashguard debrief` does not gain a boundary section based on configuration read after the recorded session.

### Later integration

After BashGuard records boundary evidence during a session, `bashguard debrief` may gain a short grounded boundary section stating what was and was not detectably contained while it ran. `bashguard doctor` may gain a pointer rather than duplicating the report; doctor covers BashGuard's installation health, not containment.

## Implementations

Two are planned, but they do not ship in the same slice:

1. **`NoSandboxAdapter` — Slice 1.** Reports that no supported containment backend was detected. This closes today's silent-boundary gap without claiming the environment is definitely unsandboxed.
2. **`AnthropicSandboxRuntimeAdapter` — later.** Covers the first-party `pi-extension-sandbox` / ASRT path after the integration spike. It is local, first-party, supports macOS and Linux, and has a concretely demonstrable tool-coverage gap.

Docker Sandboxes, GKE Agent Sandbox, E2B, Gondolin, OpenShell, and third-party `pi-sandbox` adapters are explicitly deferred until someone asks for them. The adapter *shape* is the durable contribution; breadth is a maintenance treadmill of thin adapters, each needing a test environment this project does not have, in exchange for weak differentiation.

## Open question for the ASRT adapter

From reading the example implementation, sandbox violations appear to surface as command output and a nonzero exit code rather than as structured decision events. If that holds, `observe()` starts thin and `describe()` carries this slice. That gap is the concrete candidate for an upstream contribution, and it should be documented as a finding rather than worked around with inference.

## Test strategy

### Slice 1

Write tests first for:

- the `SandboxAdapter` contract and `NoSandboxAdapter.describe()` result;
- the no-backend report using detected-not-absent wording;
- the explicit outer-container/VM limitation;
- boundary formatting at representative widths, with "not covered" lines surviving width pressure;
- `bashguard boundary` plain and interactive output;
- the absence of regressions or premature boundary sections in existing debrief and doctor output.

### Later adapter and session integration

Write tests first for:

- `describe()` against representative configurations: absent, global only, project only, both merged, malformed, and explicitly disabled;
- the reported/observed/unknown labelling rules, including the rule that configuration alone never yields an observed boundary;
- coverage-gap derivation — that a backend mediating only `bash` reports `read`, `write`, and `edit` as not mediated;
- `observe()` correlating recorded evidence by `toolCallId`, and returning nothing when no structured decisions exist;
- session-time boundary recording and a debrief section that appears only when grounded in that recorded evidence.

## Documentation scope

Update README, `CHANGELOG.md`, `docs/current-state.md`, `docs/product/roadmap.md`, `docs/architecture/overview.md`, `docs/research/pi-capability-matrix.md`, `docs/adr/decision-log.md`, `docs/release/checklist.md`, and the bundled skill. Track under issue #79.

Documentation must keep stating that BashGuard describes and reports boundaries rather than enforcing them, and that a reported boundary is not a proven active one.

## Deferred decisions

1. **Structured decision evidence.** Whether to pursue an upstream contribution so sandbox allow/deny/violation decisions are observable as events rather than parsed from output.
2. **Third-party `pi-sandbox`.** Whether `carderne/pi-sandbox` exposes a richer decision surface than ASRT, and whether it warrants a third adapter.
3. **Policy translation.** Whether BashGuard ever expresses policy intent that it translates into backend configuration. Issue #79 correctly warns against building a policy language before the integration proves what a backend supports cleanly; nothing here does so.
4. **Downstream authorization.** The one control in the taxonomy that neither BashGuard nor the current backends address.
