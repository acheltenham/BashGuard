import { createBashTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { appendProbeRecord, loadProbeContext } from "../probe-io.ts";

const SPAWN_PREFIX = "export BASHGUARD_SPIKE_SPAWN=1; ";

export default function replacementBash(pi: ExtensionAPI): void {
  const context = loadProbeContext();
  const bash = createBashTool(process.cwd(), {
    spawnHook: ({ command, cwd, env }) => {
      appendProbeRecord(context, "spawn_hook_input", { command, cwd });
      const wrapped = SPAWN_PREFIX + command;
      appendProbeRecord(context, "spawn_hook_output", { command: wrapped, cwd });
      return { command: wrapped, cwd, env };
    },
  });
  pi.registerTool({ ...bash, label: "bash (command resolution probe)" });
}
