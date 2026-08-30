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
  type SegmentKind,
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

function tokenSegment(
  command: string,
  id: string,
  kind: SegmentKind,
  needle: string,
  occurrence = 0,
  relations: readonly ReturnType<typeof relation>[] = [],
) {
  return segment(id, kind, needle, spanOf(command, needle, occurrence), relations);
}

function gitTarget(option: "-C" | "--git-dir" | "--work-tree", value: string) {
  return { option, value } as const;
}

const backgroundAndOr = `sleep 1 & false || echo fallback`;
const pipeBoth = `printf 'stderr\\n' |& cat`;
const commentPrintf = `printf '%s\\n' 'git reset --hard' # trailing comment`;
const heredocInertData = `cat <<'EOF'\ngit clean -fdn\nEOF`;
const escapedQuotedPaths = `cp "./quoted path/src file.txt" ./escaped\\ path/dst\\ file.txt`;
const gitSequentialTargeting = `git -C ./repo-a -C ./repo-b status`;
const gitMissingOption = `git --git-dir status`;
const gitConflictingOptions = `git --git-dir=.git --git-dir=../other.git status`;
const pathOperationCollision = `printf '%s\\n' './repo/-rf' './repo/--hard'`;
const optionCharacterCollision = `cp ./paths/-n ./paths/--hard ./out`;
const aliasFunction = `alias rm='printf alias'; f(){ printf function; }; rm ./target; f`;
const sourceDot = `source ./env.sh && . ./more.sh`;
const bashShC = `bash -c 'printf ok' && sh -c 'printf ok'`;
const pythonNodeC = `python -c 'print("ok")' && node -c "console.log('ok')"`;
const xargsVariants = `printf '%s\\n' ./target | xargs -r -I{} echo {} && printf '%s\\0' ./target | xargs -0 echo`;
const findExec = `find . -name '*.tmp' -exec printf '%s\\n' {} +`;
const processSubstitution = `diff <(printf a) <(printf b)`;
const parameterExpansion = `echo "\${HOME}/.config/\${project:-default}"`;
const evalCommand = `cmd='git reset --hard'; eval "$cmd"`;
const malformedRecovery = `echo "unterminated`;
const longCommand = `printf '%s\\n' '${"l".repeat(180)}'`;
const chainPipelineNewline = `alpha && beta | gamma; delta\nepsilon`;
const pipelineShape = `printf 'pipeline-data\\n' | node ./runtime-fixture.mjs pipeline-token pipeline-label`;
const prefixShape = `env BASHGUARD_SPIKE_PREFIX=prefix-value node ./runtime-fixture.mjs prefix-token prefix-label`;
const directoryChangeShape = `cd ./nested && node ../runtime-fixture.mjs directory-token directory-label`;
const harmlessRmShape = `rm -rf ./target && node ./runtime-fixture.mjs rm-token rm-label`;
const protectedQuotedPositive = `echo 'git reset --hard'`;
const protectedReset = `git -C ./repo-a reset --hard HEAD~1`;
const protectedClean = `git --git-dir=.git --work-tree=./repo-path clean -fd`;
const protectedCleanDryRun = `git --git-dir=.git --work-tree=./repo-path clean -fdn`;
const protectedRecursiveRm = `rm -rf ./target`;

const corpus = validateShellAnalysisCorpus([
  fixture({
    id: "sa-001-background-and-or",
    title: "Background operators and short-circuit OR stay distinct",
    family: "background-and-or",
    command: backgroundAndOr,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(backgroundAndOr),
        tokenSegment(backgroundAndOr, "sleep", "word", "sleep"),
        tokenSegment(backgroundAndOr, "background", "operator", "&"),
        tokenSegment(backgroundAndOr, "false", "word", "false"),
        tokenSegment(backgroundAndOr, "or", "operator", "||"),
        tokenSegment(backgroundAndOr, "echo", "word", "echo"),
        tokenSegment(backgroundAndOr, "fallback", "word", "fallback"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["background execution and short-circuit flow are runtime behavior"],
    }),
  }),
  fixture({
    id: "sa-002-pipe-both",
    title: "Pipe both preserves stderr/ stdout piping as syntax",
    family: "pipe-both",
    command: pipeBoth,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(pipeBoth),
        tokenSegment(pipeBoth, "printf", "word", "printf"),
        tokenSegment(pipeBoth, "pipe-both", "operator", "|&"),
        tokenSegment(pipeBoth, "cat", "word", "cat"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["pipe-both is shell runtime behavior"],
    }),
  }),
  fixture({
    id: "sa-003-comments-printf",
    title: "Comments and printf keep inert dangerous text as data",
    family: "comments-printf",
    command: commentPrintf,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(commentPrintf),
        tokenSegment(commentPrintf, "printf", "word", "printf"),
        tokenSegment(commentPrintf, "printf-format", "quoted", "'%s\\n'"),
        tokenSegment(commentPrintf, "printf-data", "quoted", "'git reset --hard'"),
        tokenSegment(commentPrintf, "comment", "comment", "# trailing comment"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("quoted-git-reset", "quoted-text", "'git reset --hard'", spanOf(commentPrintf, "'git reset --hard'"), "quoted text is inert data, not a command boundary")],
      protectedChecks: [protectedCheck("git-reset-hard", "matched", "observed", "git reset --hard")],
      diagnostics: [],
      runtimeUnknowns: ["quoted and commented text is inert to the shell even when it looks risky"],
    }),
  }),
  fixture({
    id: "sa-004-heredoc-inert-data",
    title: "Quoted heredoc data stays inert even when it looks dangerous",
    family: "heredoc-inert-data",
    command: heredocInertData,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(heredocInertData),
        tokenSegment(heredocInertData, "cat", "word", "cat"),
        tokenSegment(heredocInertData, "heredoc", "heredoc", "<<'EOF'"),
      ],
      wrappers: [],
      redirections: [redirection("heredoc-redirection", "<<", "<<'EOF'", spanOf(heredocInertData, "<<'EOF'"), "EOF", spanOf(heredocInertData, "EOF"), spanOf(heredocInertData, "git clean -fdn"))],
      unresolved: [unresolved("heredoc-body", "unknown", "git clean -fdn", spanOf(heredocInertData, "git clean -fdn"), "heredoc body is payload data, not executable command text")],
      protectedChecks: [protectedCheck("git-clean-forced", "not-matched", "observed", "git clean -fdn")],
      diagnostics: [],
      runtimeUnknowns: ["heredoc body is inert shell data"],
    }),
  }),
  fixture({
    id: "sa-005-escaped-quoted-paths",
    title: "Escaped and quoted paths remain paths",
    family: "escaped-quoted-paths",
    command: escapedQuotedPaths,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(escapedQuotedPaths),
        tokenSegment(escapedQuotedPaths, "cp", "word", "cp"),
        tokenSegment(escapedQuotedPaths, "quoted-source", "quoted", '"./quoted path/src file.txt"'),
        tokenSegment(escapedQuotedPaths, "escaped-dest", "escaped", "./escaped\\ path/dst\\ file.txt"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["quoted and escaped paths may resolve differently at runtime"],
    }),
  }),
  fixture({
    id: "sa-006-git-sequential-targeting",
    title: "Sequential git -C options stay literal",
    family: "git-sequential-targeting",
    command: gitSequentialTargeting,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(gitSequentialTargeting),
        tokenSegment(gitSequentialTargeting, "git", "word", "git"),
        tokenSegment(gitSequentialTargeting, "git-c-1", "wrapper", "-C ./repo-a"),
        tokenSegment(gitSequentialTargeting, "git-c-2", "wrapper", "-C ./repo-b"),
        tokenSegment(gitSequentialTargeting, "status", "word", "status"),
      ],
      wrappers: [
        wrapper("git-c-wrapper-1", "prefix", "-C ./repo-a", spanOf(gitSequentialTargeting, "-C ./repo-a")),
        wrapper("git-c-wrapper-2", "prefix", "-C ./repo-b", spanOf(gitSequentialTargeting, "-C ./repo-b")),
      ],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      literalGitTargetOptions: [gitTarget("-C", "./repo-a"), gitTarget("-C", "./repo-b")],
      diagnostics: [],
      runtimeUnknowns: ["the final repository target still depends on git runtime resolution"],
    }),
  }),
  fixture({
    id: "sa-007-git-missing-option",
    title: "Missing git target values stay unresolved",
    family: "git-missing-conflicting-options",
    command: gitMissingOption,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "observed",
      subset: "degraded",
      segments: [
        commandSegment(gitMissingOption),
        tokenSegment(gitMissingOption, "git", "word", "git"),
        tokenSegment(gitMissingOption, "missing-git-dir", "wrapper", "--git-dir"),
        tokenSegment(gitMissingOption, "status", "word", "status"),
      ],
      wrappers: [wrapper("git-missing-git-dir", "prefix", "--git-dir", spanOf(gitMissingOption, "--git-dir"))],
      redirections: [],
      unresolved: [unresolved("missing-git-dir-value", "unknown", "--git-dir", spanOf(gitMissingOption, "--git-dir"), "the option is missing a literal value")],
      protectedChecks: [],
      literalGitTargetOptions: [],
      diagnostics: [diagnostic("missing-value", "warning", "git --git-dir requires a literal value", spanOf(gitMissingOption, "--git-dir"))],
      runtimeUnknowns: ["the command text is incomplete and cannot verify a repository target"],
    }),
  }),
  fixture({
    id: "sa-008-git-conflicting-options",
    title: "Conflicting git target options stay visible as repeated literals",
    family: "git-missing-conflicting-options",
    command: gitConflictingOptions,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "observed",
      subset: "degraded",
      segments: [
        commandSegment(gitConflictingOptions),
        tokenSegment(gitConflictingOptions, "git", "word", "git"),
        tokenSegment(gitConflictingOptions, "git-dir-1", "wrapper", "--git-dir=.git"),
        tokenSegment(gitConflictingOptions, "git-dir-2", "wrapper", "--git-dir=../other.git", 0),
        tokenSegment(gitConflictingOptions, "status", "word", "status"),
      ],
      wrappers: [
        wrapper("git-dir-wrapper-1", "prefix", "--git-dir=.git", spanOf(gitConflictingOptions, "--git-dir=.git")),
        wrapper("git-dir-wrapper-2", "prefix", "--git-dir=../other.git", spanOf(gitConflictingOptions, "--git-dir=../other.git")),
      ],
      redirections: [],
      unresolved: [unresolved("conflicting-git-dir", "unknown", "--git-dir=.git --git-dir=../other.git", spanOf(gitConflictingOptions, "--git-dir=.git --git-dir=../other.git"), "repeated git target options can conflict at runtime")],
      protectedChecks: [],
      literalGitTargetOptions: [gitTarget("--git-dir", ".git"), gitTarget("--git-dir", "../other.git")],
      diagnostics: [diagnostic("conflicting-options", "warning", "repeated git target options may conflict", spanOf(gitConflictingOptions, "--git-dir=.git"))],
      runtimeUnknowns: ["later git option handling decides the effective repository target"],
    }),
  }),
  fixture({
    id: "sa-009-path-operation-collision",
    title: "Option-looking path names stay data when quoted",
    family: "path-operation-collision",
    command: pathOperationCollision,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(pathOperationCollision),
        tokenSegment(pathOperationCollision, "printf", "word", "printf"),
        tokenSegment(pathOperationCollision, "format", "quoted", "'%s\\n'"),
        tokenSegment(pathOperationCollision, "path-rf", "quoted", "'./repo/-rf'"),
        tokenSegment(pathOperationCollision, "path-hard", "quoted", "'./repo/--hard'"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["quoted path names can look like options without becoming options"],
    }),
  }),
  fixture({
    id: "sa-010-option-character-collision",
    title: "Leading dash path names remain data when unquoted as arguments",
    family: "option-character-collision",
    command: optionCharacterCollision,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(optionCharacterCollision),
        tokenSegment(optionCharacterCollision, "cp", "word", "cp"),
        tokenSegment(optionCharacterCollision, "path-n", "word", "./paths/-n"),
        tokenSegment(optionCharacterCollision, "path-hard", "word", "./paths/--hard"),
        tokenSegment(optionCharacterCollision, "out", "word", "./out"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["path-like argv still needs runtime argv interpretation"],
    }),
  }),
  fixture({
    id: "sa-011-alias-function",
    title: "Aliases and functions remain runtime identity, not syntax certainty",
    family: "alias-function",
    command: aliasFunction,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(aliasFunction),
        tokenSegment(aliasFunction, "alias", "word", "alias"),
        tokenSegment(aliasFunction, "rm-alias", "quoted", "'printf alias'"),
        tokenSegment(aliasFunction, "function-name", "word", "f"),
        tokenSegment(aliasFunction, "function-body", "group", "{ printf function; }"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [
        unresolved("alias-identity", "alias", "alias rm='printf alias'", spanOf(aliasFunction, "alias rm='printf alias'"), "an alias may expand differently at runtime"),
        unresolved("function-identity", "function", "f(){ printf function; }", spanOf(aliasFunction, "f(){ printf function; }"), "function contents are runtime identity, not fixed command text"),
      ],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["aliases and functions may change execution identity at runtime"],
    }),
  }),
  fixture({
    id: "sa-012-source-dot",
    title: "source and dot remain runtime file loading",
    family: "source-dot",
    command: sourceDot,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(sourceDot),
        tokenSegment(sourceDot, "source", "wrapper", "source"),
        tokenSegment(sourceDot, "dot", "wrapper", ".", 1),
        tokenSegment(sourceDot, "env-sh", "word", "./env.sh"),
        tokenSegment(sourceDot, "more-sh", "word", "./more.sh"),
      ],
      wrappers: [
        wrapper("source-wrapper", "shell", "source ./env.sh", spanOf(sourceDot, "source ./env.sh")),
        wrapper("dot-wrapper", "shell", ". ./more.sh", spanOf(sourceDot, ". ./more.sh")),
      ],
      redirections: [],
      unresolved: [
        unresolved("source-load", "shell-expansion", "source ./env.sh", spanOf(sourceDot, "source ./env.sh"), "source executes file contents in the current shell"),
        unresolved("dot-load", "shell-expansion", ". ./more.sh", spanOf(sourceDot, ". ./more.sh"), "dot executes file contents in the current shell"),
      ],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["the sourced files are runtime inputs outside the command text"],
    }),
  }),
  fixture({
    id: "sa-013-bash-sh-c",
    title: "bash -c and sh -c wrap a runtime shell string",
    family: "bash-sh-c",
    command: bashShC,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(bashShC),
        tokenSegment(bashShC, "bash", "word", "bash"),
        tokenSegment(bashShC, "bash-c", "wrapper", "-c"),
        tokenSegment(bashShC, "bash-script", "quoted", "'printf ok'"),
        tokenSegment(bashShC, "sh", "word", "sh"),
        tokenSegment(bashShC, "sh-c", "wrapper", "-c", 1),
        tokenSegment(bashShC, "sh-script", "quoted", "'printf ok'", 1),
      ],
      wrappers: [
        wrapper("bash-wrapper", "shell", "bash -c", spanOf(bashShC, "bash -c")),
        wrapper("sh-wrapper", "shell", "sh -c", spanOf(bashShC, "sh -c")),
      ],
      redirections: [],
      unresolved: [
        unresolved("bash-c-script", "shell-expansion", "'printf ok'", spanOf(bashShC, "'printf ok'"), "the script string is reinterpreted by bash at runtime"),
        unresolved("sh-c-script", "shell-expansion", "'printf ok'", spanOf(bashShC, "'printf ok'", 1), "the script string is reinterpreted by sh at runtime"),
      ],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["the nested shell determines runtime argv and cwd"],
    }),
  }),
  fixture({
    id: "sa-014-python-node-c",
    title: "python -c and node -c keep one-liners as runtime code strings",
    family: "python-node-c",
    command: pythonNodeC,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(pythonNodeC),
        tokenSegment(pythonNodeC, "python", "word", "python"),
        tokenSegment(pythonNodeC, "python-c", "wrapper", "-c"),
        tokenSegment(pythonNodeC, "python-code", "quoted", "'print(\"ok\")'"),
        tokenSegment(pythonNodeC, "node", "word", "node"),
        tokenSegment(pythonNodeC, "node-c", "wrapper", "-c", 1),
        tokenSegment(pythonNodeC, "node-code", "quoted", '"console.log(\'ok\')"'),
      ],
      wrappers: [
        wrapper("python-wrapper", "shell", "python -c", spanOf(pythonNodeC, "python -c")),
        wrapper("node-wrapper", "shell", "node -c", spanOf(pythonNodeC, "node -c")),
      ],
      redirections: [],
      unresolved: [
        unresolved("python-code-string", "shell-expansion", "'print(\"ok\")'", spanOf(pythonNodeC, "'print(\"ok\")'"), "python executes the code string at runtime"),
        unresolved("node-code-string", "shell-expansion", '"console.log(\'ok\')"', spanOf(pythonNodeC, '"console.log(\'ok\')"'), "node checks or runs a code string at runtime"),
      ],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["interpreter -c strings are runtime code, not shell syntax structure"],
    }),
  }),
  fixture({
    id: "sa-015-xargs-variants",
    title: "xargs option variants remain literal flags around a runtime sink",
    family: "xargs-variants",
    command: xargsVariants,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(xargsVariants),
        tokenSegment(xargsVariants, "printf", "word", "printf"),
        tokenSegment(xargsVariants, "xargs", "word", "xargs"),
        tokenSegment(xargsVariants, "xargs-r", "operator", "-r"),
        tokenSegment(xargsVariants, "xargs-I", "operator", "-I{}"),
        tokenSegment(xargsVariants, "echo-1", "word", "echo"),
        tokenSegment(xargsVariants, "printf-null", "word", "printf", 1),
        tokenSegment(xargsVariants, "xargs-0", "operator", "-0"),
        tokenSegment(xargsVariants, "echo-2", "word", "echo", 1),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("xargs-sink", "shell-expansion", "xargs -r -I{} echo {}", spanOf(xargsVariants, "xargs -r -I{} echo {}"), "xargs reinterprets input at runtime"), unresolved("xargs-null-sink", "shell-expansion", "xargs -0 echo", spanOf(xargsVariants, "xargs -0 echo"), "xargs argument handling is runtime driven")],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["xargs option handling is runtime behavior"],
    }),
  }),
  fixture({
    id: "sa-016-find-exec",
    title: "find -exec stays a runtime sink with explicit command text",
    family: "find-exec",
    command: findExec,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(findExec),
        tokenSegment(findExec, "find", "word", "find"),
        tokenSegment(findExec, "pattern", "quoted", "'*.tmp'"),
        tokenSegment(findExec, "exec", "dynamic-sink", "-exec"),
        tokenSegment(findExec, "printf", "word", "printf"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("find-exec-sink", "command-substitution", "-exec printf '%s\\n' {} +", spanOf(findExec, "-exec printf '%s\\n' {} +"), "find executes a runtime command for each match")],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["find determines the executed argv at runtime"],
    }),
  }),
  fixture({
    id: "sa-017-process-substitution",
    title: "Process substitution remains unsupported runtime plumbing",
    family: "process-substitution",
    command: processSubstitution,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(processSubstitution),
        tokenSegment(processSubstitution, "diff", "word", "diff"),
        tokenSegment(processSubstitution, "sub-left", "substitution", "<(printf a)"),
        tokenSegment(processSubstitution, "sub-right", "substitution", "<(printf b)"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("process-sub-left", "process-substitution", "<(printf a)", spanOf(processSubstitution, "<(printf a)"), "process substitution creates runtime file descriptors or named pipes"), unresolved("process-sub-right", "process-substitution", "<(printf b)", spanOf(processSubstitution, "<(printf b)"), "process substitution creates runtime file descriptors or named pipes")],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["process substitution is shell-specific runtime plumbing"],
    }),
  }),
  fixture({
    id: "sa-018-parameter-expansion",
    title: "Parameter expansion preserves observed syntax but not runtime values",
    family: "parameter-expansion",
    command: parameterExpansion,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(parameterExpansion),
        tokenSegment(parameterExpansion, "echo", "word", "echo"),
        tokenSegment(parameterExpansion, "param", "substitution", "${HOME}/.config/${project:-default}"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("param-expansion", "parameter-expansion", "${HOME}/.config/${project:-default}", spanOf(parameterExpansion, "${HOME}/.config/${project:-default}"), "parameter values are runtime shell data")],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["parameter expansion depends on runtime environment values"],
    }),
  }),
  fixture({
    id: "sa-019-eval",
    title: "Eval reinterprets command text at runtime",
    family: "eval",
    command: evalCommand,
    expected: expectation({
      status: "degraded",
      evidenceLevel: "inferred",
      subset: "degraded",
      segments: [
        commandSegment(evalCommand),
        tokenSegment(evalCommand, "assignment-cmd", "assignment", "cmd='git reset --hard'"),
        tokenSegment(evalCommand, "eval", "dynamic-sink", "eval"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("eval-sink", "eval", "eval \"$cmd\"", spanOf(evalCommand, "eval \"$cmd\""), "eval can reinterpret the assigned string as shell text")],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["eval makes runtime command identity depend on the assigned string", "the text matcher cannot safely infer the assigned command"],
    }),
  }),
  fixture({
    id: "sa-020-malformed-recovery",
    title: "Malformed syntax produces a bounded recovery failure",
    family: "malformed-recovery",
    command: malformedRecovery,
    expected: expectation({
      status: "failed",
      evidenceLevel: "observed",
      subset: "unsupported",
      segments: [commandSegment(malformedRecovery), tokenSegment(malformedRecovery, "unterminated", "unknown", '"unterminated')],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("parse-error", "parse-error", 'echo "unterminated', span(0, malformedRecovery.length), "an unclosed quote prevents reliable structural recovery")],
      protectedChecks: [],
      diagnostics: [diagnostic("parse-error", "error", "unterminated double quote", spanOf(malformedRecovery, '"unterminated'))],
      runtimeUnknowns: ["the command cannot be executed as written"],
    }),
  }),
  fixture({
    id: "sa-021-long-bounded",
    title: "Long commands stay bounded for transport and reporting",
    family: "long-bounded",
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
    id: "sa-022-command-resolution-shape",
    title: "Command resolution shape preserves chain, pipe, and newline ordering",
    family: "command-resolution-shape",
    command: chainPipelineNewline,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(chainPipelineNewline),
        tokenSegment(chainPipelineNewline, "alpha", "word", "alpha"),
        tokenSegment(chainPipelineNewline, "and-and", "operator", "&&"),
        tokenSegment(chainPipelineNewline, "beta", "word", "beta"),
        tokenSegment(chainPipelineNewline, "pipe", "operator", "|"),
        tokenSegment(chainPipelineNewline, "gamma", "word", "gamma"),
        tokenSegment(chainPipelineNewline, "semicolon", "operator", ";"),
        tokenSegment(chainPipelineNewline, "delta", "word", "delta"),
        tokenSegment(chainPipelineNewline, "newline", "operator", "\n"),
        tokenSegment(chainPipelineNewline, "epsilon", "word", "epsilon"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["operator ordering is syntax, while execution order is runtime"],
    }),
  }),
  fixture({
    id: "sa-023-command-resolution-prefix-env",
    title: "Command resolution shape keeps env prefix and assignment visible",
    family: "command-resolution-shape",
    command: prefixShape,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(prefixShape),
        tokenSegment(prefixShape, "env", "wrapper", "env"),
        tokenSegment(prefixShape, "assignment", "assignment", "BASHGUARD_SPIKE_PREFIX=prefix-value"),
        tokenSegment(prefixShape, "node", "word", "node"),
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
    id: "sa-024-command-resolution-directory-change",
    title: "Command resolution shape keeps cd boundaries visible",
    family: "command-resolution-shape",
    command: directoryChangeShape,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(directoryChangeShape),
        tokenSegment(directoryChangeShape, "cd", "word", "cd"),
        tokenSegment(directoryChangeShape, "node", "word", "node"),
      ],
      wrappers: [wrapper("cd-wrapper", "shell", "cd ./nested", spanOf(directoryChangeShape, "cd ./nested"))],
      redirections: [],
      unresolved: [],
      protectedChecks: [],
      diagnostics: [],
      runtimeUnknowns: ["cd can change cwd for later segments in the same command"],
    }),
  }),
  fixture({
    id: "sa-025-command-resolution-harmless-rm",
    title: "Command resolution shape keeps a destructive-looking rm explicit",
    family: "command-resolution-shape",
    command: harmlessRmShape,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(harmlessRmShape),
        tokenSegment(harmlessRmShape, "rm", "word", "rm"),
        tokenSegment(harmlessRmShape, "flags", "operator", "-rf"),
        tokenSegment(harmlessRmShape, "node", "word", "node"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("recursive-forced-deletion", "matched", "observed", "rm -rf ./target")],
      diagnostics: [],
      runtimeUnknowns: ["the disposable target is only a text fixture"],
    }),
  }),
  fixture({
    id: "sa-026-protected-quoted-positive",
    title: "Quoted dangerous text still matches the current textual baseline",
    family: "protected-check",
    command: protectedQuotedPositive,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(protectedQuotedPositive),
        tokenSegment(protectedQuotedPositive, "echo", "word", "echo"),
        tokenSegment(protectedQuotedPositive, "quoted-rm", "quoted", "'git reset --hard'"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [unresolved("quoted-rm", "quoted-text", "'git reset --hard'", spanOf(protectedQuotedPositive, "'git reset --hard'"), "quoted text is inert to the shell but still visible to a text matcher")],
      protectedChecks: [protectedCheck("git-reset-hard", "matched", "observed", "git reset --hard")],
      diagnostics: [],
      runtimeUnknowns: ["the quoted text is not executed, but the current matcher still sees it"],
    }),
  }),
  fixture({
    id: "sa-027-protected-rm-positive",
    title: "Recursive rm matches the filesystem-removal check",
    family: "protected-check",
    command: protectedRecursiveRm,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(protectedRecursiveRm),
        tokenSegment(protectedRecursiveRm, "rm", "word", "rm"),
        tokenSegment(protectedRecursiveRm, "flags", "operator", "-rf"),
      ],
      wrappers: [],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("recursive-forced-deletion", "matched", "observed", "rm -rf ./target")],
      diagnostics: [],
      runtimeUnknowns: ["a disposable fixture target is still not a real session target"],
    }),
  }),
  fixture({
    id: "sa-028-protected-git-reset-hard",
    title: "git reset --hard matches the destructive Git check",
    family: "protected-check",
    command: protectedReset,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(protectedReset),
        tokenSegment(protectedReset, "git", "word", "git"),
        tokenSegment(protectedReset, "git-c", "wrapper", "-C ./repo-a"),
        tokenSegment(protectedReset, "reset", "word", "reset"),
        tokenSegment(protectedReset, "hard", "operator", "--hard"),
      ],
      wrappers: [wrapper("git-c-wrapper", "prefix", "-C ./repo-a", spanOf(protectedReset, "-C ./repo-a"))],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("git-reset-hard", "matched", "observed", "git reset --hard")],
      literalGitTargetOptions: [gitTarget("-C", "./repo-a")],
      diagnostics: [],
      runtimeUnknowns: ["later shell layers may still alter execution details"],
    }),
  }),
  fixture({
    id: "sa-029-protected-git-clean-force",
    title: "Forced git clean matches the destructive Git check",
    family: "protected-check",
    command: protectedClean,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(protectedClean),
        tokenSegment(protectedClean, "git", "word", "git"),
        tokenSegment(protectedClean, "git-dir", "wrapper", "--git-dir=.git"),
        tokenSegment(protectedClean, "git-work-tree", "wrapper", "--work-tree=./repo-path"),
        tokenSegment(protectedClean, "clean", "word", "clean"),
        tokenSegment(protectedClean, "flags", "operator", "-fd"),
      ],
      wrappers: [
        wrapper("git-dir-wrapper", "prefix", "--git-dir=.git", spanOf(protectedClean, "--git-dir=.git")),
        wrapper("git-work-tree-wrapper", "prefix", "--work-tree=./repo-path", spanOf(protectedClean, "--work-tree=./repo-path")),
      ],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("git-clean-forced", "matched", "observed", "git clean -fd")],
      literalGitTargetOptions: [gitTarget("--git-dir", ".git"), gitTarget("--work-tree", "./repo-path")],
      diagnostics: [],
      runtimeUnknowns: ["target paths remain literal text without repository verification"],
    }),
  }),
  fixture({
    id: "sa-030-protected-git-clean-dry-run",
    title: "Dry-run git clean remains a negative example",
    family: "protected-check",
    command: protectedCleanDryRun,
    expected: expectation({
      status: "structured",
      evidenceLevel: "observed",
      subset: "supported",
      segments: [
        commandSegment(protectedCleanDryRun),
        tokenSegment(protectedCleanDryRun, "git", "word", "git"),
        tokenSegment(protectedCleanDryRun, "git-dir", "wrapper", "--git-dir=.git"),
        tokenSegment(protectedCleanDryRun, "git-work-tree", "wrapper", "--work-tree=./repo-path"),
        tokenSegment(protectedCleanDryRun, "clean", "word", "clean"),
        tokenSegment(protectedCleanDryRun, "flags", "operator", "-fdn"),
      ],
      wrappers: [
        wrapper("git-dir-wrapper-dry", "prefix", "--git-dir=.git", spanOf(protectedCleanDryRun, "--git-dir=.git")),
        wrapper("git-work-tree-wrapper-dry", "prefix", "--work-tree=./repo-path", spanOf(protectedCleanDryRun, "--work-tree=./repo-path")),
      ],
      redirections: [],
      unresolved: [],
      protectedChecks: [protectedCheck("git-clean-forced", "not-matched", "observed", "git clean -fdn")],
      literalGitTargetOptions: [gitTarget("--git-dir", ".git"), gitTarget("--work-tree", "./repo-path")],
      diagnostics: [],
      runtimeUnknowns: ["dry-run remains a negative example even when the text looks close"],
    }),
  }),
] as const);

export function shellAnalysisCorpus(): readonly CorpusFixture[] {
  return corpus;
}

function ensureSpanMatches(command: string, spanValue: { readonly start: number; readonly end: number }, text: string, context: string): void {
  if (spanValue.start < 0 || spanValue.end > command.length || spanValue.start > spanValue.end) {
    throw new Error(`${context} span is out of bounds`);
  }
  if (command.slice(spanValue.start, spanValue.end) !== text) {
    throw new Error(`${context} span does not match text: ${text}`);
  }
}

function validateRelationTargets(fixtureRecord: CorpusFixture, ids: Set<string>, relationLinks: readonly ReturnType<typeof relation>[]): void {
  for (const link of relationLinks) {
    if (!ids.has(link.targetId)) throw new Error(`fixture ${fixtureRecord.id} references missing relation target ${link.targetId}`);
  }
}

export function validateShellAnalysisCorpus(fixtures: readonly CorpusFixture[] = corpus): readonly CorpusFixture[] {
  const ids = new Set<string>();
  for (const fixtureRecord of fixtures) {
    if (!ids.add(fixtureRecord.id)) throw new Error(`duplicate corpus fixture id: ${fixtureRecord.id}`);
    if (!/^sa-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fixtureRecord.id)) throw new Error(`unsafe corpus fixture id: ${fixtureRecord.id}`);
    const expected = fixtureRecord.expected;
    if (!expected.segments.length) throw new Error(`fixture must declare structural expectations: ${fixtureRecord.id}`);
    for (const entry of [...expected.segments, ...expected.wrappers, ...expected.redirections, ...expected.unresolved]) {
      ensureSpanMatches(fixtureRecord.command, entry.span, entry.text, `${fixtureRecord.id}:${entry.id}`);
    }
    for (const entry of expected.diagnostics) {
      if (!entry.code || !/^[a-z0-9][a-z0-9-]*$/.test(entry.code)) throw new Error(`fixture ${fixtureRecord.id} contains an invalid diagnostic code: ${entry.code}`);
      if (!entry.message) throw new Error(`fixture ${fixtureRecord.id} contains an empty diagnostic message for ${entry.code}`);
      if (entry.span) ensureSpanMatches(fixtureRecord.command, entry.span, fixtureRecord.command.slice(entry.span.start, entry.span.end), `${fixtureRecord.id}:diagnostic:${entry.code}`);
    }
    for (const entry of expected.protectedChecks) {
      if (!entry.text) throw new Error(`fixture ${fixtureRecord.id} contains an empty protected check text`);
    }
    for (const runtimeUnknown of expected.runtimeUnknowns) {
      if (!runtimeUnknown.trim()) throw new Error(`fixture ${fixtureRecord.id} contains an empty runtime unknown description`);
      if (/^(unknown|unsafe|n\/a|null|none)$/i.test(runtimeUnknown.trim())) throw new Error(`fixture ${fixtureRecord.id} contains an unsafe runtime unknown description: ${runtimeUnknown}`);
    }
    const segmentIds = new Set(expected.segments.map((segmentEntry) => segmentEntry.id));
    for (const entry of expected.segments) validateRelationTargets(fixtureRecord, segmentIds, entry.relations);
    for (const entry of expected.wrappers) validateRelationTargets(fixtureRecord, segmentIds, entry.relations);
    for (const entry of expected.redirections) validateRelationTargets(fixtureRecord, segmentIds, entry.relations);
  }
  return fixtures;
}
