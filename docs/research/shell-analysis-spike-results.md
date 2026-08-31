# Shell Analysis Spike Results

**Status:** Stage A complete; no production adoption yet
**Last updated:** August 31, 2026

Stage A compared the documented shell-analysis options against the branch's demonstrated corpus, package, latency, and startup evidence. The decision is a no-go for production adoption right now: the current matcher baseline is still the strongest proven path, Tree-sitter native/WASM do not beat it on the corpus, the narrow analyzer remains incomplete, and `dcg` was unavailable locally. The upstream license/protocol facts below are primary-source-inspected reported facts; local `dcg` runtime behavior remains unverified here because the binary/build was unavailable. Stage B remains a deferred restart point, not a shipped change.

## Documented vs demonstrated matrix

| Candidate | Documented in design | Demonstrated on this branch | Decision |
|---|---|---|---|
| Current matcher baseline | Safe commands should stay quiet; protected textual matches remain the fallback. | 27/30 corpus passes; 0 errors; safe p50 0.02 ms / p95 0.13 ms. | Keep as the production baseline. |
| Tree-sitter native behind a narrow IR | Parser can represent lists, pipelines, groups, redirects, quotes, wrappers, and source spans without execution. | 16/30 exact corpus passes; 14 mismatches; native init 5 ms; grammar dependency `tree-sitter-bash` is 20,282,555 bytes; offline Pi startup timed out; the projection prototype is already 48.4 kB. | Reject for production now. |
| Tree-sitter WASM behind a narrow IR | Same structural model, but without a native build step. | 16/30 exact corpus passes; 14 mismatches; wasm init 23 ms; the same 20,282,555-byte grammar dependency; offline Pi startup timed out. | Reject for production now. |
| Narrow analyzer | Deliberately bounded comparator that should stay smaller than a parser. | Safe p50 0.07 ms / p95 0.13 ms; package smoke loaded; no corpus proof that it closes the structural gaps. | Reject for production now. |
| `dcg` | External reference with robot/classify/explain surfaces and an optional Pi bridge. | Primary-source-inspected license text includes an OpenAI/Anthropic rider; the robot/classify/explain protocol is source/test documented; local binary/build execution was unavailable. | Reference only. |
| Bounded Git probe | No-shell `git rev-parse` after a relevant structural match. | Safe p50 27.85 ms / p95 30.48 ms; error p50 0.46 ms / p95 0.49 ms; external cost 18 ms. | Keep as a later gated step. |

The committed Tree-sitter report shows 16/30 exact status/check/target matches for both native and WASM variants. If you were tracking an earlier 13/30 note, the conclusion is unchanged: both variants are still behind the current matcher baseline's 27/30 corpus passes.

## Evidence highlights

- `tree-sitter-bash` contributes the 20,282,555-byte grammar cost; the package smoke only proves the branch can load candidate packages, not that the dependency is cheap enough for production.
- Candidate package smoke succeeded for the narrow, native, and WASM prototypes, but offline Pi startup timed out, so runtime auth behavior remains unproven.
- The BashGuard package smoke now packs with `npm pack --pack-destination` into a temporary isolated root, then resolves and extracts there; it also executes a dedicated `pi install -l <package-root>` with isolated cwd, `PI_CODING_AGENT_DIR`, and `BASHGUARD_DATA_DIR`.
- The smoke observed isolated roots and sentinel files, but it does not prove that every external read was absent.
- The isolated BashGuard tarball is now packed into a temporary root before extraction; the package install still uses `npm install --omit=dev`, the dedicated `pi install -l <package-root>` step ran with isolated cwd/config/data roots, and startup evidence remained missing.
- Current matcher latency is effectively negligible on safe fixtures, while native/WASM Tree-sitter add small but real init and analysis overhead.
- `dcg` was not available locally, so no local runtime or install smoke could justify shipping it as a production dependency; the deterministic parser fixture exercises a recorded shape only and is not a real `dcg` execution.

## Benchmark summary

| Adapter | Init | Safe p50 / p95 | Error p50 / p95 | Notes |
|---|---|---|---|---|
| Current matcher baseline | 292 ms | 0.02 ms / 0.13 ms | 0.01 ms / 0.04 ms | Observed current matcher only. |
| Narrow shell analyzer | 1 ms | 0.07 ms / 0.13 ms | 0.06 ms / 0.17 ms | Fast, but still intentionally incomplete. |
| Tree-sitter native | 5 ms | 0.20 ms / 1.08 ms | 0.21 ms / 0.51 ms | Available, but not corpus-dominant. |
| Tree-sitter WASM | 23 ms | 0.17 ms / 0.40 ms | 0.21 ms / 0.51 ms | Available, but not corpus-dominant. |
| Git probe | 0 ms | 27.85 ms / 30.48 ms | 0.46 ms / 0.49 ms | Read-only probe only, after a structural match. |
| `dcg` process adapter | n/a | n/a | n/a | Binary not found: `dcg`. |

## Decision

No production adoption yet.

Keep the current matcher baseline in production.

Do not make Tree-sitter native, Tree-sitter WASM, the narrow analyzer, or `dcg` a runtime dependency on the strength of the current evidence.

## Restart point

The Stage B restart point is [`docs/plans/2026-08-28-shell-aware-command-analysis-stage-b-implementation.md`](../plans/2026-08-28-shell-aware-command-analysis-stage-b-implementation.md).

Issue #90 stays open. Issue #91 stays separate.
