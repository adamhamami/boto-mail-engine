import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import {
  aggregateDnsStatus,
  defaultDkimSelectors,
  evaluateDkimRecords,
  evaluateDmarcRecords,
  evaluateMxRecords,
  evaluateReverseDns,
  evaluateSpfRecords,
  extractDomainFromEmail,
  extractSpfRecords,
  isValidDnsDomain,
  resolveDkimSelectors,
  runDnsChecks,
} from "@/lib/dns/checks";
import type { DnsResolver } from "@/lib/dns/resolver";
import { flattenTxtRecords } from "@/lib/dns/resolver";
import {
  getDnsHealth,
  resetDnsHealthCache,
  setDnsResolverOverride,
} from "@/lib/dns/dns-health";

const ENV_SNAPSHOT = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>): void {
  process.env = {
    ...ENV_SNAPSHOT,
    NODE_ENV: "test",
    AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
    ...overrides,
  } as NodeJS.ProcessEnv;
  resetEnvCache();
  resetDnsHealthCache();
}

afterEach(() => {
  process.env = { ...ENV_SNAPSHOT };
  resetEnvCache();
  resetDnsHealthCache();
  setDnsResolverOverride(null);
});

describe("Phase 3 — validation domaine", () => {
  it("accepte un FQDN et refuse URL / IP / localhost", () => {
    expect(isValidDnsDomain("botoschool.com")).toBe(true);
    expect(isValidDnsDomain("mail.botoschool.ma")).toBe(true);
    expect(isValidDnsDomain("https://botoschool.com")).toBe(false);
    expect(isValidDnsDomain("127.0.0.1")).toBe(false);
    expect(isValidDnsDomain("localhost")).toBe(false);
  });

  it("extrait le domaine depuis SMTP_FROM_EMAIL", () => {
    expect(extractDomainFromEmail("noreply@botoschool.com")).toBe(
      "botoschool.com",
    );
    expect(extractDomainFromEmail("bad")).toBeNull();
  });
});

describe("Phase 3 — SPF", () => {
  it("ERROR si absent", () => {
    const result = evaluateSpfRecords([]);
    expect(result.status).toBe("ERROR");
    expect(result.summary).toMatch(/Aucun enregistrement SPF/i);
  });

  it("ERROR si plusieurs enregistrements", () => {
    const result = evaluateSpfRecords([
      "v=spf1 include:_spf.google.com -all",
      "v=spf1 include:spf.protection.outlook.com -all",
    ]);
    expect(result.status).toBe("ERROR");
    expect(result.summary).toMatch(/Plusieurs/i);
  });

  it("ERROR pour +all", () => {
    expect(evaluateSpfRecords(["v=spf1 +all"]).status).toBe("ERROR");
    expect(evaluateSpfRecords(["v=spf1 mx all"]).status).toBe("ERROR");
  });

  it("WARNING pour ~all et OK pour -all", () => {
    expect(
      evaluateSpfRecords(["v=spf1 include:spf.brevo.com ~all"]).status,
    ).toBe("WARNING");
    expect(
      evaluateSpfRecords(["v=spf1 include:spf.brevo.com -all"]).status,
    ).toBe("OK");
  });

  it("extrait uniquement les TXT SPF", () => {
    expect(
      extractSpfRecords([
        "v=spf1 -all",
        "google-site-verification=abc",
        "V=SPF1 include:x -all",
      ]),
    ).toHaveLength(2);
  });
});

describe("Phase 3 — DKIM", () => {
  it("ERROR si aucune clé pour les sélecteurs", () => {
    const result = evaluateDkimRecords({
      selectorsTried: ["mail", "brevo"],
      found: [],
    });
    expect(result.status).toBe("ERROR");
    expect(result.summary).toMatch(/Aucune clé DKIM/i);
  });

  it("OK si clé publique présente", () => {
    const result = evaluateDkimRecords({
      selectorsTried: ["mail"],
      found: [
        {
          selector: "mail",
          records: ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"],
        },
      ],
    });
    expect(result.status).toBe("OK");
  });

  it("ERROR si p= vide (révocation)", () => {
    const result = evaluateDkimRecords({
      selectorsTried: ["mail"],
      found: [{ selector: "mail", records: ["v=DKIM1; p="] }],
    });
    expect(result.status).toBe("ERROR");
    expect(result.summary).toMatch(/révoquée/i);
  });

  it("résout les sélecteurs env puis presets fournisseur", () => {
    expect(resolveDkimSelectors("brevo", "custom1,custom2")).toEqual([
      "custom1",
      "custom2",
    ]);
    expect(defaultDkimSelectors("brevo")).toContain("mail");
    expect(defaultDkimSelectors("sendgrid")).toContain("s1");
  });
});

describe("Phase 3 — DMARC", () => {
  it("ERROR si absent", () => {
    expect(evaluateDmarcRecords([]).status).toBe("ERROR");
  });

  it("WARNING pour p=none, OK pour p=reject", () => {
    expect(
      evaluateDmarcRecords(["v=DMARC1; p=none; rua=mailto:a@b.com"]).status,
    ).toBe("WARNING");
    expect(
      evaluateDmarcRecords(["v=DMARC1; p=reject; rua=mailto:a@b.com"]).status,
    ).toBe("OK");
  });

  it("WARNING sans rua même en p=reject", () => {
    expect(evaluateDmarcRecords(["v=DMARC1; p=reject"]).status).toBe(
      "WARNING",
    );
  });
});

describe("Phase 3 — MX", () => {
  it("ERROR si aucun MX", () => {
    expect(evaluateMxRecords([]).status).toBe("ERROR");
  });

  it("OK si MX valides", () => {
    const result = evaluateMxRecords([
      { exchange: "mx1.example.com", priority: 10 },
      { exchange: "mx2.example.com", priority: 20 },
    ]);
    expect(result.status).toBe("OK");
    expect(result.details[0]).toContain("priorité 10");
  });

  it("ERROR si MX localhost", () => {
    expect(
      evaluateMxRecords([{ exchange: "localhost", priority: 0 }]).status,
    ).toBe("ERROR");
  });
});

describe("Phase 3 — Reverse DNS", () => {
  it("ERROR sans PTR", () => {
    const result = evaluateReverseDns({
      smtpHost: "smtp.example.com",
      addresses: ["203.0.113.10"],
      ptrByIp: { "203.0.113.10": [] },
    });
    expect(result.status).toBe("ERROR");
  });

  it("OK avec PTR sur toutes les IP", () => {
    const result = evaluateReverseDns({
      smtpHost: "smtp.example.com",
      addresses: ["203.0.113.10"],
      ptrByIp: { "203.0.113.10": ["mail.example.com"] },
    });
    expect(result.status).toBe("OK");
    expect(result.summary).toMatch(/PTR présent/i);
  });

  it("WARNING si PTR partiel", () => {
    const result = evaluateReverseDns({
      smtpHost: "smtp.example.com",
      addresses: ["203.0.113.10", "203.0.113.11"],
      ptrByIp: {
        "203.0.113.10": ["mail.example.com"],
        "203.0.113.11": [],
      },
    });
    expect(result.status).toBe("WARNING");
  });
});

describe("Phase 3 — agrégation et TXT", () => {
  it("agrège ERROR > WARNING > OK", () => {
    expect(aggregateDnsStatus([{ status: "OK" }, { status: "WARNING" }])).toBe(
      "WARNING",
    );
    expect(aggregateDnsStatus([{ status: "WARNING" }, { status: "ERROR" }])).toBe(
      "ERROR",
    );
    expect(aggregateDnsStatus([{ status: "OK" }])).toBe("OK");
  });

  it("joint les fragments TXT Node", () => {
    expect(flattenTxtRecords([["v=spf1 ", "include:x -all"]])).toEqual([
      "v=spf1 include:x -all",
    ]);
  });
});

class FakeDnsResolver implements DnsResolver {
  constructor(
    private readonly data: {
      txt?: Record<string, string[][]>;
      mx?: Record<string, Array<{ exchange: string; priority: number }>>;
      a?: Record<string, string[]>;
      ptr?: Record<string, string[]>;
    },
  ) {}

  async resolveTxt(hostname: string): Promise<string[][]> {
    const hit = this.data.txt?.[hostname.toLowerCase()];
    if (!hit) {
      const err = new Error("ENODATA") as Error & { code: string };
      err.code = "ENODATA";
      throw err;
    }
    return hit;
  }

  async resolveMx(hostname: string) {
    const hit = this.data.mx?.[hostname.toLowerCase()];
    if (!hit) {
      const err = new Error("ENODATA") as Error & { code: string };
      err.code = "ENODATA";
      throw err;
    }
    return hit;
  }

  async resolve4(hostname: string) {
    return this.data.a?.[hostname.toLowerCase()] ?? [];
  }

  async resolve6(): Promise<string[]> {
    return [];
  }

  async reverse(ip: string) {
    return this.data.ptr?.[ip] ?? [];
  }
}

describe("Phase 3 — orchestration (résolveur factice)", () => {
  beforeEach(() => {
    setEnv({
      MAIL_PROVIDER: "brevo",
      SMTP_FROM_EMAIL: "noreply@example.com",
      SMTP_HOST: "smtp-relay.brevo.com",
      DKIM_SELECTORS: "mail",
    });
  });

  it("produit les 5 contrôles avec explications", async () => {
    const resolver = new FakeDnsResolver({
      txt: {
        "example.com": [["v=spf1 include:spf.brevo.com -all"]],
        "mail._domainkey.example.com": [
          ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"],
        ],
        "_dmarc.example.com": [["v=DMARC1; p=quarantine; rua=mailto:d@example.com"]],
      },
      mx: {
        "example.com": [{ exchange: "mx.example.com", priority: 10 }],
      },
      a: {
        "smtp-relay.brevo.com": ["1.2.3.4"],
      },
      ptr: {
        "1.2.3.4": ["smtp-relay.brevo.com"],
      },
    });

    const { checks } = await runDnsChecks({
      domain: "example.com",
      smtpHost: "smtp-relay.brevo.com",
      mailProvider: "brevo",
      dkimSelectors: ["mail"],
      resolver,
    });

    expect(checks.map((c) => c.id)).toEqual([
      "spf",
      "dkim",
      "dmarc",
      "mx",
      "rdns",
    ]);
    expect(aggregateDnsStatus(checks)).toBe("OK");
    for (const check of checks) {
      expect(check.summary.length).toBeGreaterThan(10);
      expect(["OK", "WARNING", "ERROR"]).toContain(check.status);
    }
  });

  it("getDnsHealth n'expose pas l'hôte SMTP complet", async () => {
    setDnsResolverOverride(
      new FakeDnsResolver({
        txt: {
          "example.com": [["v=spf1 include:spf.brevo.com -all"]],
          "mail._domainkey.example.com": [
            ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"],
          ],
          "_dmarc.example.com": [["v=DMARC1; p=none"]],
        },
        mx: {
          "example.com": [{ exchange: "mx.example.com", priority: 10 }],
        },
        a: { "smtp-relay.brevo.com": ["1.2.3.4"] },
        ptr: { "1.2.3.4": ["smtp-relay.brevo.com"] },
      }),
    );

    const report = await getDnsHealth({ force: true });
    const serialized = JSON.stringify(report);

    expect(report.domain).toBe("example.com");
    expect(report.smtpHostMasked).toContain("***");
    expect(serialized).not.toContain("smtp-relay.brevo.com:587");
    expect(report.checks).toHaveLength(5);
    expect(report.status).toBe("WARNING"); // DMARC p=none sans rua
    expect(report.checks.find((c) => c.id === "dmarc")?.status).toBe(
      "WARNING",
    );
  });
});
