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
