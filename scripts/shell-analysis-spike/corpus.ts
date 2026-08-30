import {
  diagnostic,
  expectation,
  fixture,
  protectedCheck,
  relation,
  redirection,
  segment,
  span,
  type CorpusFixture,
  unresolved,
  wrapper,
} from "./model.ts";

function spanOf(command: string, needle: string, occurrence = 0) {
  let index = -1;
  let from = 0;
  for (let count = 0; count <= occurrence; count += 1) {
    index = command.indexOf(needle, from);
    if (index < 0) throw new Error(`missing substring ${needle} in corpus command`);
    from = index + needle.length;
  }
  return span(index, index + needle.length);
}

function commandSegment(command: string) {
  return segment("command", "command", command, span(0, command.length));
}

const inertQuotedText = `echo 'git reset --hard'`;
const quotedEscapes = `printf '%s\\n' "a\\ b" 'c'\\''d'`;
const operatorsAndNewlines = `alpha && beta | gamma; delta\nepsilon`;
const groupsAndSubshells = `(cd ./repo-a && echo ready) && { printf done; }`;
const assignmentsAndWrappers = `FOO=1 env BAR=2 sh -c 'printf ok'`;
const redirectsAndHeredoc = `cat < input.txt >> output.txt <<'EOF'\nbody\nEOF`;
const gitTargetCollision = `git -C "./repo path" --git-dir=.git --work-tree "./repo path" status`;
const dynamicSink = `cmd=$(printf 'git reset --hard') && eval "$cmd"`;
const malformedSyntax = `echo "unterminated`;
const longCommand = `printf '%s\\n' '${"l".repeat(180)}'`;
const pipelineShape = `printf 'pipeline-data\\n' | node ./runtime-fixture.mjs pipeline-token pipeline-label`;
const prefixShape = `env BASHGUARD_SPIKE_PREFIX=prefix-value node ./runtime-fixture.mjs prefix-token prefix-label`;
const directoryChangeShape = `cd ./nested && node ../runtime-fixture.mjs directory-token directory-label`;
const harmlessRmShape = `rm -rf ./target && node ./runtime-fixture.mjs rm-token rm-label`;
const protectedReset = `git -C ./repo-a reset --hard HEAD~1`;
const protectedClean = `git --git-dir=.git --work-tree="./repo path" clean -fd`;
const protectedRecursiveRm = `rm -rf ./target`;

const corpus: CorpusFixture[] = [
  fixture({
    id: "sa-001-inert-quoted-text",
    title: "Quoted protected text stays inert",
    family: "inert-text",
    command: inertQuotedText,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "observed",
      subset: "degraded",
      segments: [
        commandSegment(inertQuotedText),
        segment("word-echo", "word", "echo", spanOf(inertQuotedText, "echo"), [relation("contains", "quoted-protected-text")]),
        segment("quoted-protected-text", "quoted", "'git reset --hard'", spanOf(inertQuotedText, "'git reset --hard'")),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [
        unresolved(
          "quoted-text",
          "quoted-text",
          "'git reset --hard'",
          spanOf(inertQuotedText, "'git reset --hard'"),
          "quoted text may be printed rather than executed",
        ),
      ],
      protectedChecks: [protectedCheck("git-reset-hard", "not-matched", "observed", "quoted text should remain inert")],
      diagnostics: [],
      runtimeUnknowns: ["shell may print the quoted text instead of executing it"],
    }),
  }),
  fixture({
    id: "sa-002-quotes-and-escapes",
    title: "Quotes and escapes preserve literal text",
    family: "quotes-and-escapes",
    command: quotedEscapes,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(quotedEscapes),
        segment("word-printf", "word", "printf", spanOf(quotedEscapes, "printf")),
        segment("quoted-format", "quoted", "'%s\\n'", spanOf(quotedEscapes, "'%s\\n'"), [relation("contains", "escaped-newline")]),
        segment("escaped-newline", "escaped", "\\n", spanOf(quotedEscapes, "\\n")),
        segment("double-quoted-word", "quoted", '"a\\ b"', spanOf(quotedEscapes, '"a\\ b"')),
        segment("single-quoted-word", "quoted", "'c'", spanOf(quotedEscapes, "'c'")),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["shell quoting may still affect runtime argv"],
    }),
  }),
  fixture({
    id: "sa-003-compounds-operators-newlines",
    title: "Compounds, operators, and newlines stay ordered",
    family: "operators-and-newlines",
    command: operatorsAndNewlines,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(operatorsAndNewlines),
        segment("alpha", "word", "alpha", spanOf(operatorsAndNewlines, "alpha"), [relation("precedes", "and-and"), relation("precedes", "newline")]),
        segment("and-and", "operator", "&&", spanOf(operatorsAndNewlines, "&&"), [relation("branches-to", "beta")]),
        segment("beta", "word", "beta", spanOf(operatorsAndNewlines, "beta"), [relation("precedes", "pipe")]),
        segment("pipe", "operator", "|", spanOf(operatorsAndNewlines, "|"), [relation("branches-to", "gamma")]),
        segment("gamma", "word", "gamma", spanOf(operatorsAndNewlines, "gamma"), [relation("precedes", "semicolon")]),
        segment("semicolon", "operator", ";", spanOf(operatorsAndNewlines, ";"), [relation("branches-to", "delta")]),
        segment("delta", "word", "delta", spanOf(operatorsAndNewlines, "delta"), [relation("precedes", "newline")]),
        segment("newline", "operator", "\n", spanOf(operatorsAndNewlines, "\n"), [relation("branches-to", "epsilon")]),
        segment("epsilon", "word", "epsilon", spanOf(operatorsAndNewlines, "epsilon")),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["operators can still alter execution order at runtime"],
    }),
  }),
  fixture({
    id: "sa-004-groups-subshells",
    title: "Groups and subshells bound later commands",
    family: "groups-and-subshells",
    command: groupsAndSubshells,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(groupsAndSubshells),
        segment("subshell", "subshell", "(cd ./repo-a && echo ready)", spanOf(groupsAndSubshells, "(cd ./repo-a && echo ready)"), [relation("contains", "group")]),
        segment("group", "group", "{ printf done; }", spanOf(groupsAndSubshells, "{ printf done; }")),
        segment("cd", "word", "cd", spanOf(groupsAndSubshells, "cd"), [relation("follows", "subshell")]),
      ],
      wrappers: [wrapper("subshell-wrapper", "subshell", "(cd ./repo-a && echo ready)", spanOf(groupsAndSubshells, "(cd ./repo-a && echo ready)"))],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["subshell and group boundaries can change cwd and scope at runtime"],
    }),
  }),
  fixture({
    id: "sa-005-assignments-wrappers",
    title: "Assignments and wrappers remain explicit",
    family: "assignments-and-wrappers",
    command: assignmentsAndWrappers,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(assignmentsAndWrappers),
        segment("assignment-foo", "assignment", "FOO=1", spanOf(assignmentsAndWrappers, "FOO=1"), [relation("wraps", "env-wrapper")]),
        segment("env-wrapper", "wrapper", "env", spanOf(assignmentsAndWrappers, "env"), [relation("wraps", "assignment-bar")]),
        segment("assignment-bar", "assignment", "BAR=2", spanOf(assignmentsAndWrappers, "BAR=2"), [relation("wraps", "shell-wrapper")]),
        segment("shell-wrapper", "wrapper", "sh -c", spanOf(assignmentsAndWrappers, "sh -c")),
      ],
      wrappers: [
        wrapper("env-wrapper-obs", "env", "env", spanOf(assignmentsAndWrappers, "env"), [relation("wraps", "assignment-bar")]),
        wrapper("shell-wrapper-obs", "shell", "sh -c", spanOf(assignmentsAndWrappers, "sh -c")),
      ],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["wrapper tools can change the actual process tree and argv"],
    }),
  }),
  fixture({
    id: "sa-006-redirects-heredocs",
    title: "Redirects and heredocs remain separate from the executable",
    family: "redirects-and-heredocs",
    command: redirectsAndHeredoc,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(redirectsAndHeredoc),
        segment("cat", "word", "cat", spanOf(redirectsAndHeredoc, "cat"), [relation("targets", "input-redirect"), relation("targets", "append-redirect"), relation("targets", "heredoc")]),
        segment("input-redirect", "redirect", "< input.txt", spanOf(redirectsAndHeredoc, "< input.txt")),
        segment("append-redirect", "redirect", ">> output.txt", spanOf(redirectsAndHeredoc, ">> output.txt")),
        segment("heredoc", "heredoc", "<<'EOF'\nbody\nEOF", spanOf(redirectsAndHeredoc, "<<'EOF'"), [relation("contains", "heredoc-body")]),
      ],
      wrappers: [],
      redirections: [
        redirection("redirect-input", "<", "< input.txt", spanOf(redirectsAndHeredoc, "< input.txt"), "input.txt", spanOf(redirectsAndHeredoc, "input.txt")),
        redirection("redirect-append", ">>", ">> output.txt", spanOf(redirectsAndHeredoc, ">> output.txt"), "output.txt", spanOf(redirectsAndHeredoc, "output.txt")),
        redirection("heredoc-redirection", "<<", "<<'EOF'", spanOf(redirectsAndHeredoc, "<<'EOF'"), "EOF", spanOf(redirectsAndHeredoc, "EOF"), spanOf(redirectsAndHeredoc, "body"), [relation("contains", "heredoc-body")]),
      ],
      unresolved: [unresolved("heredoc-body", "unknown", "body", spanOf(redirectsAndHeredoc, "body"), "heredoc body may be shell data rather than command text")],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["heredoc body is runtime data and not a separate command"],
    }),
  }),
  fixture({
    id: "sa-007-git-target-collision",
    title: "Git global options and quoted paths remain textual evidence",
    family: "git-target-collision",
    command: gitTargetCollision,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(gitTargetCollision),
        segment("git", "word", "git", spanOf(gitTargetCollision, "git"), [relation("contains", "git-cwd"), relation("contains", "git-dir"), relation("contains", "git-work-tree")]),
        segment("git-cwd", "wrapper", "-C \"./repo path\"", spanOf(gitTargetCollision, "-C \"./repo path\"")),
        segment("git-dir", "wrapper", "--git-dir=.git", spanOf(gitTargetCollision, "--git-dir=.git")),
        segment("git-work-tree", "wrapper", "--work-tree \"./repo path\"", spanOf(gitTargetCollision, "--work-tree \"./repo path\"")),
      ],
      wrappers: [
        wrapper("git-cwd-wrapper", "prefix", "-C \"./repo path\"", spanOf(gitTargetCollision, "-C \"./repo path\"")),
        wrapper("git-dir-wrapper", "prefix", "--git-dir=.git", spanOf(gitTargetCollision, "--git-dir=.git")),
        wrapper("git-work-tree-wrapper", "prefix", "--work-tree \"./repo path\"", spanOf(gitTargetCollision, "--work-tree \"./repo path\"")),
      ],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["literal target options do not prove the canonical repository path"],
    }),
  }),
  fixture({
    id: "sa-008-dynamic-sink",
    title: "Dynamic sinks remain unresolved",
    family: "dynamic-sink",
    command: dynamicSink,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(dynamicSink),
        segment("assignment-cmd", "assignment", "cmd=...", spanOf(dynamicSink, "cmd="), [relation("wraps", "command-substitution")]),
        segment("command-substitution", "substitution", "$(printf 'git reset --hard')", spanOf(dynamicSink, "$(printf 'git reset --hard')")),
        segment("eval-call", "wrapper", "eval", spanOf(dynamicSink, "eval")),
      ],
      wrappers: [wrapper("eval-wrapper", "shell", "eval", spanOf(dynamicSink, "eval"))],
      redirections: [],
      unresolved: [
        unresolved("command-substitution-unknown", "command-substitution", "$(printf 'git reset --hard')", spanOf(dynamicSink, "$(printf 'git reset --hard')"), "the substituted value may differ from the source text"),
        unresolved("eval-unknown", "eval", "eval \"$cmd\"", spanOf(dynamicSink, "eval \"$cmd\""), "eval can re-interpret text at runtime"),
      ],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["substitution result, eval expansion, and child argv are runtime-only"],
    }),
  }),
  fixture({
    id: "sa-009-malformed-syntax",
    title: "Malformed syntax is explicitly unsupported",
    family: "malformed-syntax",
    command: malformedSyntax,
    expected: expectation({
      status: "failed",
      evidenceLevel: "observed",
      subset: "unsupported",
      segments: [commandSegment(malformedSyntax), segment("unterminated-quote", "unknown", '"unterminated', spanOf(malformedSyntax, '"unterminated'))],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("parse-error", "parse-error", 'echo "unterminated', span(0, malformedSyntax.length), "unclosed quote prevents stable structural analysis")],
      protectedChecks: [],
      diagnostics: [diagnostic("parse-error", "error", "unterminated double quote", spanOf(malformedSyntax, '"unterminated'))],
      runtimeUnknowns: ["the command cannot be reliably executed as written"],
    }),
  }),
  fixture({
    id: "sa-010-long-command",
    title: "Long commands stay bounded and sanitized",
    family: "long-command",
    command: longCommand,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "observed",
      subset: "degraded",
      segments: [commandSegment(longCommand)],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [diagnostic("length-warning", "info", "long command text should stay bounded for reporting")],
      runtimeUnknowns: ["very long payloads may be truncated in later transport layers"],
    }),
  }),
  fixture({
    id: "sa-011-shape-pipeline",
    title: "Pipeline shape mirrors the resolution spike",
    family: "command-resolution-shape",
    command: pipelineShape,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(pipelineShape),
        segment("printf", "word", "printf", spanOf(pipelineShape, "printf"), [relation("branches-to", "pipe")]),
        segment("pipe", "operator", "|", spanOf(pipelineShape, "|"), [relation("branches-to", "node")]),
        segment("node", "word", "node", spanOf(pipelineShape, "node")),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["pipeline data flow is runtime behavior rather than static text"],
    }),
  }),
  fixture({
    id: "sa-012-shape-prefix-env",
    title: "Environment prefix shape mirrors the resolution spike",
    family: "command-resolution-shape",
    command: prefixShape,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(prefixShape),
        segment("env", "wrapper", "env", spanOf(prefixShape, "env"), [relation("wraps", "prefix-assign")]),
        segment("prefix-assign", "assignment", "BASHGUARD_SPIKE_PREFIX=prefix-value", spanOf(prefixShape, "BASHGUARD_SPIKE_PREFIX=prefix-value")),
        segment("node", "word", "node", spanOf(prefixShape, "node")),
      ],
      wrappers: [wrapper("env-prefix", "env", "env", spanOf(prefixShape, "env"))],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["environment expansion and child argv remain runtime-only"],
    }),
  }),
  fixture({
    id: "sa-013-shape-directory-change",
    title: "Directory-change shape mirrors the resolution spike",
    family: "command-resolution-shape",
    command: directoryChangeShape,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(directoryChangeShape),
        segment("cd", "word", "cd", spanOf(directoryChangeShape, "cd"), [relation("branches-to", "node-child")]),
        segment("node-child", "word", "node", spanOf(directoryChangeShape, "node")),
      ],
      wrappers: [wrapper("cd-wrapper", "shell", "cd ./nested", spanOf(directoryChangeShape, "cd ./nested"))],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["shell built-ins can change cwd after the command text is observed"],
    }),
  }),
  fixture({
    id: "sa-014-shape-harmless-rm",
    title: "Protected-looking rm shape stays local to a disposable target",
    family: "command-resolution-shape",
    command: harmlessRmShape,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(harmlessRmShape),
        segment("rm", "word", "rm", spanOf(harmlessRmShape, "rm"), [relation("branches-to", "rm-flags")]),
        segment("rm-flags", "operator", "-rf", spanOf(harmlessRmShape, "-rf")),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("recursive-forced-deletion", "matched", "observed", "rm -rf ./target")],
      diagnostics: [],
      runtimeUnknowns: ["the disposable target is only a text fixture and not a real repository path"],
    }),
  }),
  fixture({
    id: "sa-015-protected-reset-hard",
    title: "Git reset hard matches the destructive Git check",
    family: "protected-check",
    command: protectedReset,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(protectedReset),
        segment("git", "word", "git", spanOf(protectedReset, "git"), [relation("contains", "git-cwd-option"), relation("contains", "reset-op"), relation("contains", "hard-flag")]),
        segment("git-cwd-option", "wrapper", "-C ./repo-a", spanOf(protectedReset, "-C ./repo-a")),
        segment("reset-op", "word", "reset", spanOf(protectedReset, "reset")),
        segment("hard-flag", "operator", "--hard", spanOf(protectedReset, "--hard")),
      ],
      wrappers: [wrapper("git-cwd-option-wrapper", "prefix", "-C ./repo-a", spanOf(protectedReset, "-C ./repo-a"))],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("git-reset-hard", "matched", "observed", "git reset --hard")],
      diagnostics: [],
      runtimeUnknowns: ["later shell layers may still alter execution details"],
    }),
  }),
  fixture({
    id: "sa-016-protected-clean-force",
    title: "Forced Git clean matches the destructive Git check",
    family: "protected-check",
    command: protectedClean,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(protectedClean),
        segment("git", "word", "git", spanOf(protectedClean, "git"), [relation("contains", "git-dir-option"), relation("contains", "git-work-tree-option"), relation("contains", "clean-op"), relation("contains", "force-flag")]),
        segment("git-dir-option", "wrapper", "--git-dir=.git", spanOf(protectedClean, "--git-dir=.git")),
        segment("git-work-tree-option", "wrapper", "--work-tree=\"./repo path\"", spanOf(protectedClean, "--work-tree=\"./repo path\"")),
        segment("clean-op", "word", "clean", spanOf(protectedClean, "clean")),
        segment("force-flag", "operator", "-fd", spanOf(protectedClean, "-fd")),
      ],
      wrappers: [
        wrapper("git-dir-wrapper-obs", "prefix", "--git-dir=.git", spanOf(protectedClean, "--git-dir=.git")),
        wrapper("git-work-tree-wrapper-obs", "prefix", "--work-tree=\"./repo path\"", spanOf(protectedClean, "--work-tree=\"./repo path\"")),
      ],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("git-clean-forced", "matched", "observed", "git clean -fd")],
      diagnostics: [],
      runtimeUnknowns: ["target paths remain literal text without repository verification"],
    }),
  }),
  fixture({
    id: "sa-017-protected-rm-recursive",
    title: "Recursive rm matches the filesystem-removal check",
    family: "protected-check",
    command: protectedRecursiveRm,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(protectedRecursiveRm),
        segment("rm", "word", "rm", spanOf(protectedRecursiveRm, "rm"), [relation("contains", "rm-flags")]),
        segment("rm-flags", "operator", "-rf", spanOf(protectedRecursiveRm, "-rf")),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("recursive-forced-deletion", "matched", "observed", "rm -rf ./target")],
      diagnostics: [],
      runtimeUnknowns: ["a disposable fixture target is still not the execution target of a real session"],
    }),
  }),
] as const;

export function shellAnalysisCorpus(): readonly CorpusFixture[] {
  return corpus;
}

export function validateShellAnalysisCorpus(fixtures: readonly CorpusFixture[] = corpus): readonly CorpusFixture[] {
  const ids = new Set<string>();
  for (const fixtureRecord of fixtures) {
    if (!ids.add(fixtureRecord.id)) throw new Error(`duplicate corpus fixture id: ${fixtureRecord.id}`);
    if (!/^sa-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fixtureRecord.id)) throw new Error(`unsafe corpus fixture id: ${fixtureRecord.id}`);
    const expected = fixtureRecord.expected;
    if (!expected.segments.length) throw new Error(`fixture must declare structural expectations: ${fixtureRecord.id}`);
  }
  return fixtures;
}
