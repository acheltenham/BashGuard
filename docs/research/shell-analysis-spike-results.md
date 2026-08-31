# Shell Analysis Spike Results

Local observations only; not guarantees.

## Environment

- Host: `darwin x64` · load `10.2 / 8.3 / 7.4` · memory `32 GiB` · host `<hash>`
- Tool versions: `node v26.4.0`, `npm 11.17.0`, `pi 0.84.4`, `git 2.54.0`
- `dcg`: not installed locally

## Exact commands run

```bash
node --experimental-strip-types scripts/shell-analysis-spike/benchmark.ts --include-commands --output-dir <tmp-path>
node --experimental-strip-types scripts/shell-analysis-spike/package-smoke.ts --include-commands --output-dir <tmp-path>
```

## Benchmark matrix

| Candidate | Kind | Cold init | Safe p50/p95 | Error p50/p95 | external cost | Notes |
|---|---|---|---|---|---|---|
| Current matcher | baseline | 286 ms | 0.02 / 0.11 ms | 0.01 / 0.04 ms | n/a | `string-width` 11,733 bytes; local observation only |
| Tree-sitter native | native | 5 ms | 0.17 / 0.69 ms | 0.18 / 0.48 ms | n/a | `tree-sitter` 4,454,536 bytes; `tree-sitter-bash` 20,282,555 bytes; install scripts yes; native compile yes |
| Tree-sitter WASM | wasm | 23 ms | 0.16 / 0.38 ms | 0.17 / 0.42 ms | n/a | `web-tree-sitter` 4,683,395 bytes; `tree-sitter-bash` 20,282,555 bytes; install scripts no; native compile no |
| Narrow analyzer | narrow | 1 ms | 0.05 / 0.09 ms | 0.05 / 0.13 ms | n/a | `string-width` 11,733 bytes; local observation only |
| dcg | dcg | 5 ms | 0.00 / 0.01 ms | 0.00 / 0.02 ms | n/a | blocked: `dcg binary not found: dcg` |
| Git probe | git-probe | 0 ms | 22.07 / 22.56 ms | 0.32 / 0.33 ms | 16 ms | fresh repo + missing-path candidate |

## Benchmark command log

- `git init` → `0` · `40 ms`
- `git status --porcelain=v1` → `0` · `16 ms`
- `git --version` → `0` · `11 ms`
- `npm --version` → `0` · `195 ms`

## Package smoke matrix

### Disposable candidate packages

| Candidate | Runtime deps | pack / extract / install | import-init | Notes |
|---|---|---|---|---|
| `bashguard-native-candidate` | `tree-sitter`, `tree-sitter-bash` | succeeded | loaded | memory delta `6,410,240` bytes |
| `bashguard-wasm-candidate` | `web-tree-sitter`, `tree-sitter-bash` | succeeded | loaded | memory delta `3,989,504` bytes |
| `bashguard-narrow-candidate` | `string-width`, `strip-ansi` | succeeded | loaded | memory delta `9,187,328` bytes |

### BashGuard package

- `npm pack` → `bashguard-0.4.0.tgz` (`2.15 MB` unpacked)
- `npm install --omit=dev` on the extracted package → succeeded
- `pi --mode json --offline --no-extensions --no-skills --no-context-files --no-tools -e <tmp-path> -p smoke` → blocked; session startup not proven
- `pi install -l <tmp-path>` in an isolated temp project/config root → succeeded
- auth behavior change → blocked; not proven

## Package smoke command log

- `npm pack` → `0` · `801 ms`
- `tar -xzf /Users/antoniocheltenham/BashGuard/.worktrees/shell-analysis-research/bashguard-0.4.0.tgz -C <tmp-path>` → `0` · `73 ms`
- `pi --mode json --offline --no-extensions --no-skills --no-context-files --no-tools -e <tmp-path> -p smoke` → unknown · `45,018 ms`
- `pi install -l <tmp-path>` → `0` · `534 ms`

## Conclusions

- Native Tree-sitter and WASM Tree-sitter both loaded in disposable packages on this host.
- The narrow analyzer loaded as a pure-JS package.
- `dcg` was unavailable locally, so only blocked evidence is recorded.
- The BashGuard tarball still did not prove `pi -e` startup in this environment, but isolated `pi install -l` succeeded without touching real user settings.
- No runtime parser dependency was added to the shipped package's dependency set during this spike.
