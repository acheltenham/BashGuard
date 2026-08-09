# BashGuard current state

**Status:** Work in progress / Milestone 0 foundation

BashGuard is an early-stage, local-first Pi companion. It is useful for observing and investigating recorded Pi sessions, but it is not yet a complete command guard, approval system, sandbox, recovery system, or security control.

## Available today

When the BashGuard Pi extension is loaded before a session starts:

- records supported Pi lifecycle, prompt, turn, tool, shell, user-bash, read, edit, write, Git snapshot, and shutdown events;
- stores the event stream locally as append-only JSONL;
- discovers active and completed BashGuard-recorded sessions;
- follows a session from another terminal with `bashguard attach`;
- inspects individual events by sequence or event ID prefix;
- reports missing, redacted, truncated, and capture-gap evidence;
- produces active or completed-session debriefs;
- shows observation-only risky-command notices;
- reports observed file-tool activity without inferring create, overwrite, or delete impact;
- compares session-start and shutdown Git snapshots;
- shows direct path overlap between changed Git files and observed file-tool events with confidence labels;
- summarizes recorded GitHub shell activity and provider-neutral recorded shell activity.

All narrative output is grounded in recorded local events. BashGuard does not live-query GitHub, deployment providers, or other remote systems during debriefing.

## Important limitations

- BashGuard cannot attach retroactively to older Pi sessions that were not recorded by the extension.
- Capture can be partial because Pi hooks, event fields, output, or storage writes may be unavailable.
- Git and file correlations are session-level or path-overlap evidence, not proof of causality.
- Risk notices are non-blocking review notes. BashGuard does not currently approve, block, interrupt, or sandbox commands.
- There is no pre-execution resolved-command preview yet.
- There is no recovery/restore workflow, event replay, browser UI, cloud service, or multi-harness support.
- The current CLI is primarily structured text; the richer split-pane TUI remains planned.
- Provider-specific activity labels are not the core model; recorded commands and outputs are the evidence.

## Recommended reporting language

Use “observed,” “recorded,” “reported,” “partial,” or “missing evidence.” Avoid saying BashGuard caused, prevented, approved, blocked, or fully reconstructed an action unless the evidence and implementation explicitly support that claim.

## Reporting a bug

Open a GitHub issue using the [bug report template](https://github.com/acheltenham/BashGuard/issues/new?template=bug_report.md).

Include, when safe:

- BashGuard version or commit;
- Pi version;
- operating system;
- command run and expected/actual output;
- whether the BashGuard extension was loaded before the Pi session started;
- session selector and `BASHGUARD_DATA_DIR` configuration, but never secrets;
- a minimal sanitized event excerpt or `bashguard inspect` output;
- reproduction steps and relevant `bashguard doctor` output.

Do not attach raw session JSONL if it contains secrets or private content. Redact first.
