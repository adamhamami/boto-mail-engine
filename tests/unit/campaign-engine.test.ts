import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  MemoryQuotaStore,
  consumeSendQuotas,
  setQuotaStore,
} from "@/lib/campaign-engine/quotas";
import {
  FakeClock,
  resetClock,
  setClock,
} from "@/lib/campaign-engine/clock";
import {
  planEmailSteps,
  computeStepScheduledAt,
  CDC_STEP_DELAY_BOUNDS,
} from "@/lib/campaign-engine/sequence-rules";
import {
  isWithinSendWindow,
  nextValidSendSlot,
  DEFAULT_SEND_WINDOW,
} from "@/lib/campaign-engine/send-window";
import { claimCampaignStart } from "@/lib/campaign-engine/claim-start";
import { scheduleCampaignStartJob } from "@/lib/campaign-engine/scheduler";
import { CampaignStatus, SequenceStepType } from "@/generated/prisma/client";
import { zonedCivilToUtc } from "@/lib/campaign-engine/timezone";

describe("Phase 4 sequence rules CDC", () => {
  it("accepts J0 / J+4 / J+10 pattern", () => {
    const steps = planEmailSteps([
      {
        id: "s0",
        stepOrder: 0,
        type: SequenceStepType.EMAIL,
        templateId: "tpl0aaaaaaaaaaaaaaaaaaaa",
        delayDays: 0,
      },
      {
        id: "s1",
        stepOrder: 1,
        type: SequenceStepType.EMAIL,
        templateId: "tpl1aaaaaaaaaaaaaaaaaaaa",
        delayDays: 5,
      },
      {
        id: "s2",
        stepOrder: 2,
        type: SequenceStepType.EMAIL,
        templateId: "tpl2aaaaaaaaaaaaaaaaaaaa",
        delayDays: 12,
      },
    ]);
    expect(steps).toHaveLength(3);
    expect(CDC_STEP_DELAY_BOUNDS[1]).toEqual({ minDays: 4, maxDays: 6 });
  });

  it("rejects more than 3 EMAIL steps", () => {
    expect(() =>
      planEmailSteps(
        [0, 1, 2, 3].map((i) => ({
          id: `s${i}`,
          stepOrder: i,
          type: SequenceStepType.EMAIL,
          templateId: `tpl${i}aaaaaaaaaaaaaaaaaaa`,
          delayDays: i === 0 ? 0 : i === 1 ? 5 : 12,
        })),
      ),
    ).toThrow(/Maximum 3/);
  });

  it("rejects invalid delay for step 2", () => {
    expect(() =>
      planEmailSteps([
        {
          id: "s0",
          stepOrder: 0,
          type: SequenceStepType.EMAIL,
          templateId: "tpl0aaaaaaaaaaaaaaaaaaaa",
          delayDays: 0,
        },
        {
          id: "s1",
          stepOrder: 1,
          type: SequenceStepType.EMAIL,
          templateId: "tpl1aaaaaaaaaaaaaaaaaaaa",
          delayDays: 2,
        },
      ]),
    ).toThrow(/delayDays/);
  });

  it("computes scheduledAt with calendar delay (no real wait)", () => {
    const start = new Date("2026-03-02T10:00:00.000Z");
    const at = computeStepScheduledAt(start, { delayDays: 4, delayHours: 0 });
    expect(at.getTime()).toBeGreaterThan(start.getTime());
    const deltaDays = (at.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(deltaDays).toBeGreaterThanOrEqual(3.5);
    expect(deltaDays).toBeLessThanOrEqual(4.5);
  });
});

describe("Phase 4 send windows Africa/Casablanca", () => {
  afterEach(() => {
    resetClock();
  });

  it("defers weekend to next Monday slot", () => {
    const saturday = zonedCivilToUtc(
      { year: 2026, month: 3, day: 7, hour: 12 },
      "Africa/Casablanca",
    );
    expect(isWithinSendWindow(saturday, DEFAULT_SEND_WINDOW)).toBe(false);
    const next = nextValidSendSlot(saturday, DEFAULT_SEND_WINDOW);
    expect(isWithinSendWindow(next, DEFAULT_SEND_WINDOW)).toBe(true);
    expect(next.getTime()).toBeGreaterThan(saturday.getTime());
  });

  it("keeps weekday morning inside window", () => {
    const monday = zonedCivilToUtc(
      { year: 2026, month: 3, day: 2, hour: 10 },
      "Africa/Casablanca",
    );
    expect(isWithinSendWindow(monday, DEFAULT_SEND_WINDOW)).toBe(true);
    expect(nextValidSendSlot(monday, DEFAULT_SEND_WINDOW).getTime()).toBe(
      monday.getTime(),
    );
  });
});

describe("Phase 4 quotas (multi-worker safe store)", () => {
  let store: MemoryQuotaStore;

  beforeEach(() => {
    store = new MemoryQuotaStore();
    setQuotaStore(store);
    setClock(new FakeClock(new Date("2026-03-02T10:00:00.000Z")));
  });

  afterEach(() => {
    setQuotaStore(null);
    resetClock();
  });

  it("enforces hourly campaign quota across two consumers", async () => {
    const limits = {
      perHour: 2,
      perDay: 100,
      perConnector: 100,
      perSenderDomain: 100,
      perCampaign: 2,
    };

    const a = await consumeSendQuotas(
      {
        campaignId: "c1",
        connector: "smtp",
        senderDomain: "botoschool.ma",
        limits,
      },
      { store },
    );
    const b = await consumeSendQuotas(
      {
        campaignId: "c1",
        connector: "smtp",
        senderDomain: "botoschool.ma",
        limits,
      },
      { store },
    );
    const c = await consumeSendQuotas(
      {
        campaignId: "c1",
        connector: "smtp",
        senderDomain: "botoschool.ma",
        limits,
      },
      { store },
    );

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
  });
});

describe("Phase 4 campaign scheduler claim + delayed job", () => {
  afterEach(() => {
    resetClock();
  });

  it("only one concurrent claim wins", async () => {
    let status: CampaignStatus = CampaignStatus.SCHEDULED;
    const db = {
      campaign: {
        updateMany: async ({ data }: { data: { status: CampaignStatus } }) => {
          if (
            status === CampaignStatus.SCHEDULED ||
            status === CampaignStatus.VALIDATED
          ) {
            status = data.status;
            return { count: 1 };
          }
          return { count: 0 };
        },
        findUnique: async () => ({ status }),
      },
    };

    const first = await claimCampaignStart("camp-1", {
      db: db as never,
      clock: new FakeClock(),
    });
    const second = await claimCampaignStart("camp-1", {
      db: db as never,
      clock: new FakeClock(),
    });

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
  });

  it("schedules future start with FakeClock delay (no real wait)", async () => {
    const clock = new FakeClock(new Date("2026-03-02T10:00:00.000Z"));
    setClock(clock);
    const scheduledAt = new Date("2026-03-02T12:00:00.000Z");
    const adds: Array<{ delay: number; jobId: string }> = [];

    const result = await scheduleCampaignStartJob({
      campaignId: "camp-1",
      scheduledAt,
      userId: "u1",
      clock,
      queueAdd: async (_name, _data, opts) => {
        adds.push({ delay: opts.delay, jobId: opts.jobId });
      },
    });

    expect(result.delayMs).toBe(2 * 60 * 60 * 1000);
    expect(adds[0]?.jobId).toBe("campaign-start:camp-1");

    await scheduleCampaignStartJob({
      campaignId: "camp-1",
      scheduledAt,
      userId: "u1",
      clock,
      queueAdd: async (_name, _data, opts) => {
        adds.push({ delay: opts.delay, jobId: opts.jobId });
      },
    });
    expect(adds.filter((a) => a.jobId === "campaign-start:camp-1")).toHaveLength(2);
  });

  it("advancing FakeClock reaches J+10 without real days", () => {
    const clock = new FakeClock(new Date("2026-03-02T10:00:00.000Z"));
    const target = new Date("2026-03-12T10:00:00.000Z");
    clock.advanceDays(10);
    expect(clock.now().getTime()).toBe(target.getTime());
  });
});
