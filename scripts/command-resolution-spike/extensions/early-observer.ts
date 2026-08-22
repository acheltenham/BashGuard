import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { appendProbeRecord, loadProbeContext } from "../probe-io.ts";

export default function earlyObserver(pi: ExtensionAPI): void {
  const context = loadProbeContext();
  pi.on("tool_call", (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    appendProbeRecord(context, "early_tool_call", {
      toolCallId: event.toolCallId,
      command: event.input.command,
      cwd: ctx.cwd,
    });
  });
}
