# Shell Command Analysis Landscape

**Access date:** 2026-08-31  
**Scope:** primary-source comparison for BashGuard Stage A; no production authorization changes.

## Pinned `dcg` upstream

- Repo: `https://github.com/Dicklesworthstone/destructive_command_guard`
- Pinned tag: `v0.9.4`
- Pinned commit: `a96388683a2c189dccb3c8c25bd425a9c83be59c`
- Crate version: `0.9.4` (`Cargo.toml`)
- License file: `LICENSE`

### Reported primary-source facts

- `LICENSE` is **MIT with an OpenAI/Anthropic rider**. That rider is part of the license text; this is not plain MIT.
- `src/cli.rs` defines `test`, `classify`, and `explain` surfaces; the protocol details below are source/test inspected facts.

### Build/run status in this environment

I cloned the repo under `/tmp/destructive_command_guard` and reviewed source/tests, but I could not complete a local build here because `cargo`/`rustup` are not on the current PATH. So this note is source/test verified, not a locally executed binary benchmark. Local runtime behavior remains unverified in this environment.

Representative local skip-path timing in this environment:

- `probeDcgBinary('dcg')` against a missing binary averaged **3.67 ms** over 20 runs.
- `analyze('git status')` on an unavailable adapter averaged **0.014 ms** over 20 runs after the probe.

These numbers describe the visible skip path, not `dcg` execution latency.

## What the upstream source/tests show

### Robot / classify / explain surfaces

- `docs/adr-002-robot-mode-api.md` documents robot mode as machine-readable JSON on stdout with standardized exit codes.
- `tests/agent_json_format.rs` and `tests/agent_exit_codes.rs` verify the JSON fields and exit-code behavior.
- `tests/codex_hook_protocol.rs` and `docs/codex-integration.md` verify Codex-specific hook output.
- These are source/test-inspected reported facts, not a locally executed runtime proof in this environment.

### Output schema facts

- `test --format json` / robot-style output carries decision fields such as `decision`, `rule_id`, `pack_id`, `reason`, `matched_span`, and `severity`.
- `classify --format json` carries `schema_version`, `dcg_version`, `command`, `decision`, `risk_level`, `risk_score`, `reasons`, and `suggestions`.
- `explain --format json` is the deep-inspection surface; upstream tests assert structured trace data.

### stdout / stderr / exit behavior

- Allowed hook calls stay quiet on stdout.
- Denials are machine-readable and keep human-readable guidance on stderr for non-robot hook paths.
- Codex uses a minimal stdout denial contract because its parser rejects extra fields.
- Robot/classify exit codes are explicit in source/tests; parse/config/IO failures have separate codes.

### Missing binary / unavailable behavior

- A missing binary is a runtime availability problem, not a new BashGuard policy fact.
- BashGuard should show that as **unavailable / skipped**, not as a fabricated allow or a repository-verification claim.
- Deterministic parser fixtures in this branch are recorded-shape tests only; they are not real `dcg` executions.

### Fail-open / fail-closed

- `src/main.rs` shows the hook-input parse/size path is **fail-open by default**.
- `DCG_FAIL_CLOSED` flips attacker-controlled JSON/size failures into a block.
- Transient IO read errors remain fail-open.
- This is hook safety behavior; it is not Git identity verification.

### Shell segmentation / deep inspection

- Upstream source/tests cover quoted inert text, heredoc scanning, inline-script scanning, compound commands, and matched spans.
- The `explain` surface adds deep inspection, but the upstream model still stays command-text centric.
- It does **not** claim to verify repository identity or final runtime argv/cwd.

## Primary-source comparison set

### Claude Code

Primary source: `https://docs.anthropic.com/en/docs/claude-code/hooks`  
Accessed: 2026-08-31

Use it here as a UX/protocol reference for pre-tool interception and approval segmentation. It is not a reusable implementation dependency.

### ShellCheck

Primary source: `https://github.com/koalaman/shellcheck`  
Accessed: 2026-08-31

Use it as an analysis reference: parser/AST-style shell checking, diagnostics, and fixture discipline. It is a linter/reference, not a BashGuard runtime dependency.

### Semgrep / Tree-sitter Bash

Primary sources:  
- `https://semgrep.dev/docs/writing-rules/pattern-syntax/`  
- `https://github.com/tree-sitter/tree-sitter-bash`

Accessed: 2026-08-31

Use them as structural-analysis references: syntax-first matching and tree-based parsing. They are reference points for Stage A, not production dependencies.

### OpenAI Codex

Primary source: `https://developers.openai.com/codex/hooks`  
Accessed: 2026-08-31

Use it as a hook/containment separation reference. The important lesson for BashGuard is that approval hooks are not containment, and hook failure behavior must remain explicit.

### Pi

Primary sources:
- Pi extensions hook: [`extensions.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- Pi package install/source behavior: [`packages.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- Pi security boundary notes: [`security.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)

Accessed: 2026-08-31

Current BashGuard pin in `package.json`: `@earendil-works/pi-coding-agent` `0.84.0`.

Key Pi facts for this stage:

- extensions are TypeScript modules and `tool_call` can mutate or block before execution ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md));
- Pi package installation behavior was observed in this Stage A branch/package research as production-oriented install flow (`npm install --omit=dev`), but that is an observation for this branch's packaging research, not a universal Pi contract ([packages.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md));
- Pi has no built-in sandbox ([security.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md));
- project trust is an input-loading gate, not a runtime isolation boundary ([security.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)).

## Reuse choices

| Choice | What it means | Fit for BashGuard |
|---|---|---|
| Runtime dependency | Ship and require `dcg` for normal operation | Not a good fit for this stage; it adds external install/build friction and makes the repo depend on a ridered upstream binary |
| Optional provider | Probe for `dcg`, use it when present, and show a visible skip/unavailable path when absent | Best fit for comparison work |
| Architectural/corpus reference | Use upstream docs/tests as evidence for BashGuard design and corpus shaping without depending on the binary | Strong fit |
| Upstream contribution | Feed protocol clarifications, fixture ideas, and edge cases back to `dcg` | Good follow-up if the maintainer wants them |

## BashGuard-specific conclusion

`dcg` is useful as an **optional comparison provider** and as a **reference corpus/source set**. It should **not** be treated as BashGuard's Git-verification layer, and its output must not be presented as proof of repository identity.

BashGuard's new fixture protocol intentionally stays sanitized: no host-specific paths, no live repository identity claims, and stable deterministic IDs.

For BashGuard, Git-target verification remains a separate concern.
