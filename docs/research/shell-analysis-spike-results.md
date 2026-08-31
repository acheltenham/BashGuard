# Shell Analysis Spike Results

Local observations only; snapshot timestamp, load, and durations are non-repeatable.

## Environment

- Host: `darwin x64` · load `12.56103515625 / 7.8828125 / 7.71240234375` · memory `32 GiB` · host `<hash>`
- Tool versions: `node v26.4.0`, `npm 11.17.0`, `pi 0.84.4`, `git git version 2.54.0`
- `dcg`: unavailable locally

## Exact commands run

```bash
node --experimental-strip-types scripts/shell-analysis-spike/benchmark.ts --include-commands --output-dir <tmp-path>
node --experimental-strip-types scripts/shell-analysis-spike/package-smoke.ts --include-commands --output-dir <tmp-path>
```

## Benchmark matrix

| Adapter | Kind | Init | Safe | Error | external cost | Dependency metrics | Notes |
|---|---|---|---|---|---|---|---|
| Current matcher baseline | baseline | 327.00 ms | safe p50 0.02 ms · safe p95 0.14 ms · n 20 | error p50 0.01 ms · error p95 0.04 ms · n 20 | n/a | string-width · 11733 bytes · install no · native no · memory 9089024 bytes | observed current matcher only; local observation only |
| dcg process adapter (unavailable) | dcg | n/a | n/a | n/a | n/a | none | dcg binary not found: dcg |
| Git probe | git-probe | 0.00 ms | safe p50 40.93 ms · safe p95 41.84 ms · n 5 | error p50 0.44 ms · error p95 0.50 ms · n 5 | 36.00 ms | none | fresh repository and missing-path candidate |
| Narrow shell analyzer | narrow | 1.00 ms | safe p50 0.06 ms · safe p95 0.13 ms · n 20 | error p50 0.06 ms · error p95 0.16 ms · n 20 | n/a | string-width · 11733 bytes · install no · native no · memory 7999488 bytes | bounded tokenizer/analyzer |
| Tree-sitter native | native | 5.00 ms | safe p50 0.20 ms · safe p95 0.62 ms · n 20 | error p50 0.21 ms · error p95 0.48 ms · n 20 | n/a | tree-sitter · 4454536 bytes · install yes · native yes · memory 3645440 bytes; tree-sitter-bash · 20282555 bytes · install yes · native yes · memory 3694592 bytes | tree-sitter native binding candidate; available |
| Tree-sitter WASM | wasm | 28.00 ms | safe p50 0.17 ms · safe p95 0.50 ms · n 20 | error p50 0.26 ms · error p95 0.52 ms · n 20 | n/a | web-tree-sitter · 4683395 bytes · install no · native no · memory 2572288 bytes; tree-sitter-bash · 20282555 bytes · install yes · native yes · memory 3448832 bytes | web-tree-sitter parser candidate; available |

## Package smoke matrix

### Disposable candidate packages

| Candidate | Runtime deps | pack / extract / install | import-init | Notes |
|---|---|---|---|---|
| `bashguard-narrow-candidate` | `string-width`, `strip-ansi` | succeeded | loaded | memory delta `8904704` bytes |
| `bashguard-native-candidate` | `tree-sitter`, `tree-sitter-bash` | succeeded | loaded | memory delta `6643712` bytes |
| `bashguard-wasm-candidate` | `web-tree-sitter`, `tree-sitter-bash` | succeeded | loaded | memory delta `3518464` bytes |

### BashGuard package

- `npm pack` succeeded; unpacked size `1.5 MB`
- `npm install --omit=dev` on the extracted package succeeded in an isolated temp root
- offline `pi --mode json --offline --no-extensions --no-skills --no-context-files --no-tools -e <tmp-path> -p smoke` timed out; runtime auth behavior remains unproven
- recorder startup evidence was missing in isolated `BASHGUARD_DATA_DIR`
- isolated registration/config evidence was observed in the temporary config root
- no writes to the sentinel snapshot were observed

## Commands

- `git --version` → exit `0` · `16 ms`
- `git init` → exit `0` · `37 ms`
- `git status --porcelain=v1` → exit `0` · `36 ms`
- `npm --version` → exit `0` · `242 ms`
- `npm install --omit=dev` → exit `0` · `2242 ms`
- `npm pack` → exit `0` · `817 ms`
- `pi --mode json --offline --no-extensions --no-skills --no-context-files --no-tools -e <tmp-path> -p smoke` → timed out · `45018 ms`
- `tar -xzf <home-path> -C <tmp-path>` → exit `0` · `83 ms`

## Conclusions

- Native Tree-sitter and WASM Tree-sitter both loaded in disposable packages on this host.
- The narrow analyzer loaded as a pure-JS package.
- `dcg` was unavailable locally, so the benchmark row is `n/a` rather than a near-zero claim.
- The BashGuard tarball installed in isolation, but offline Pi startup timed out, so runtime auth behavior remains unproven.
- Recorder startup evidence was missing in this smoke, while isolated registration/config evidence was observed.
- All paths in the committed report are sanitized.
