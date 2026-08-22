import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MUTATION_PREFIX = "export BASHGUARD_SPIKE_MUTATED=1; ";

export default function commandMutator(pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    event.input.command = MUTATION_PREFIX + event.input.command;
  });
}
