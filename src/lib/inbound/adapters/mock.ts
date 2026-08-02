import type { NormalizedMailEvent } from "../types";
import type { InboundMailAdapter } from "./types";

/**
 * Adaptateur mock pour tests / environnement sans fournisseur webhook.
 */
export class MockInboundMailAdapter implements InboundMailAdapter {
  readonly name = "mock";

  constructor(private readonly events: NormalizedMailEvent[] = []) {}

  async poll(): Promise<NormalizedMailEvent[]> {
    return [...this.events];
  }

  push(event: NormalizedMailEvent): void {
    this.events.push(event);
  }
}
