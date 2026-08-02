import dns from "node:dns/promises";
import { withHealthTimeout } from "@/lib/observability/health-timeout";

/**
 * Abstraction DNS injectable — les tests unitaires injectent un faux résolveur
 * sans toucher le réseau. En production : Node `dns/promises`.
 */

export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveMx(
    hostname: string,
  ): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  reverse(ip: string): Promise<string[]>;
}

const DEFAULT_DNS_TIMEOUT_MS = 5000;

export class NodeDnsResolver implements DnsResolver {
  constructor(private readonly timeoutMs = DEFAULT_DNS_TIMEOUT_MS) {}

  async resolveTxt(hostname: string): Promise<string[][]> {
    return withHealthTimeout(
      `dns:txt:${hostname}`,
      () => dns.resolveTxt(hostname),
      this.timeoutMs,
    );
  }

  async resolveMx(
    hostname: string,
  ): Promise<Array<{ exchange: string; priority: number }>> {
    return withHealthTimeout(
      `dns:mx:${hostname}`,
      () => dns.resolveMx(hostname),
      this.timeoutMs,
    );
  }

  async resolve4(hostname: string): Promise<string[]> {
    return withHealthTimeout(
      `dns:a:${hostname}`,
      () => dns.resolve4(hostname),
      this.timeoutMs,
    );
  }

  async resolve6(hostname: string): Promise<string[]> {
    return withHealthTimeout(
      `dns:aaaa:${hostname}`,
      () => dns.resolve6(hostname),
      this.timeoutMs,
    );
  }

  async reverse(ip: string): Promise<string[]> {
    return withHealthTimeout(
      `dns:ptr:${ip}`,
      () => dns.reverse(ip),
      this.timeoutMs,
    );
  }
}

/** TXT Node renvoie des fragments ; on les joint en un enregistrement. */
export function flattenTxtRecords(chunks: string[][]): string[] {
  return chunks
    .map((parts) => parts.join(""))
    .map((record) => record.trim())
    .filter(Boolean);
}

/**
 * Resolve TXT en ignarant NXDOMAIN / ENODATA (enregistrements absents).
 * Les autres erreurs (timeout, SERVFAIL) sont propagées.
 */
export async function resolveTxtSafe(
  resolver: DnsResolver,
  hostname: string,
): Promise<{ records: string[]; error: string | null }> {
  try {
    const raw = await resolver.resolveTxt(hostname);
    return { records: flattenTxtRecords(raw), error: null };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN") {
      return { records: [], error: null };
    }
    const message =
      error instanceof Error ? error.message : "Échec de résolution DNS";
    return { records: [], error: message };
  }
}

export async function resolveMxSafe(
  resolver: DnsResolver,
  hostname: string,
): Promise<{
  records: Array<{ exchange: string; priority: number }>;
  error: string | null;
}> {
  try {
    const records = await resolver.resolveMx(hostname);
    return {
      records: [...records].sort((a, b) => a.priority - b.priority),
      error: null,
    };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN") {
      return { records: [], error: null };
    }
    const message =
      error instanceof Error ? error.message : "Échec de résolution MX";
    return { records: [], error: message };
  }
}

export async function resolveAddressesSafe(
  resolver: DnsResolver,
  hostname: string,
): Promise<{ addresses: string[]; error: string | null }> {
  const addresses: string[] = [];
  let lastError: string | null = null;

  try {
    addresses.push(...(await resolver.resolve4(hostname)));
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "NXDOMAIN") {
      lastError =
        error instanceof Error ? error.message : "Échec de résolution A";
    }
  }

  try {
    addresses.push(...(await resolver.resolve6(hostname)));
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "NXDOMAIN") {
      lastError =
        error instanceof Error ? error.message : "Échec de résolution AAAA";
    }
  }

  return { addresses: [...new Set(addresses)], error: lastError };
}
