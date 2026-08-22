export type BoundaryEvidence = "observed" | "reported" | "unknown";

export type SandboxDecision = {
  toolCallId?: string;
  outcome: "allow" | "deny" | "violation";
  evidence: BoundaryEvidence;
  summary: string;
};

export type SandboxBoundaryDescription = {
  adapterId: string;
  evidence: BoundaryEvidence;
  isolation: string;
  mediatedTools: string[];
  filesystem: string;
  network: string;
  implications: string[];
  notCovered: string[];
};

export interface SandboxAdapter {
  describe(): Promise<SandboxBoundaryDescription>;
  observe(events: readonly unknown[]): Promise<SandboxDecision[]>;
}

export function formatBoundaryReport(description: SandboxBoundaryDescription, columns = 80): string {
  const width = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
  const mediated = description.mediatedTools.length > 0 ? description.mediatedTools.join(", ") : "nothing";
  const rows = [
    ["Isolation", `${description.isolation} · ${description.evidence}`],
    ["Mediated", mediated],
    ["Filesystem", description.filesystem],
    ["Network", description.network],
  ] as const;
  const lines = ["Boundary", ""];

  if (width >= 60) {
    for (const [label, value] of rows) lines.push(`  ${label.padEnd(15)}${value}`);
  } else {
    for (const [label, value] of rows) lines.push(label, `  ${value}`);
  }

  lines.push("", "What this means", "");
  for (const implication of description.implications) lines.push(`  - ${implication}`);
  lines.push("", "Not covered by this boundary", "");
  for (const limitation of description.notCovered) lines.push(`  - ${limitation}`);
  return lines.join("\n");
}

export class NoSandboxAdapter implements SandboxAdapter {
  async describe(): Promise<SandboxBoundaryDescription> {
    return {
      adapterId: "none-detected",
      evidence: "unknown",
      isolation: "none detected",
      mediatedTools: [],
      filesystem: "no supported restrictions detected",
      network: "no supported restrictions detected",
      implications: [
        "Without an outer boundary, Pi tools run with the permissions of your user account.",
      ],
      notCovered: [
        "any outer container or VM, which BashGuard cannot characterize from inside",
        "downstream authority of credentials available to the session",
      ],
    };
  }

  async observe(_events: readonly unknown[]): Promise<SandboxDecision[]> {
    return [];
  }
}
