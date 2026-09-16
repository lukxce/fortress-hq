/**
 * The ad-schedule trap.
 *
 * Google treats ad schedules as an allowlist: the moment a campaign has any ad
 * schedule criterion, it stops running at every hour not covered by one. So a
 * naive "bid 40% less between 00:00 and 06:00" adds one criterion — and the
 * campaign silently goes dark for the other eighteen hours of every day.
 *
 * fullWeekSchedule therefore always writes a complete week: the requested band
 * at its modifier (or left out, when excluding), and every other hour of every
 * day explicitly at 1.0. It replaces any existing schedule rather than adding
 * to it, and respects Google's limit of six entries per day by handing back the
 * weakest adjustments first instead of failing the write.
 */

export const WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type Day = (typeof WEEK)[number];

export type ScheduleRequest = {
  start_hour: number;      // 0–23
  end_hour: number;        // 1–24, exclusive; a value ≤ start wraps past midnight
  days: Day[];
  mode: "exclude" | "adjust";
  bid_adjust_pct?: number; // for "adjust"
};

export type ScheduleEntry = { day: Day; startHour: number; endHour: number; bidModifier: number };

const MAX_PER_DAY = 6;

/** Hours of the day inside the band, handling a band that wraps midnight. */
export function hoursInBand(start: number, end: number): Set<number> {
  const out = new Set<number>();
  const e = end % 24;
  if (start < end && end <= 24) {
    for (let h = start; h < end; h++) out.add(h);
  } else {
    for (let h = start; h < 24; h++) out.add(h);
    for (let h = 0; h < e; h++) out.add(h);
  }
  return out;
}

export function fullWeekSchedule(req: ScheduleRequest): ScheduleEntry[] {
  const band = hoursInBand(req.start_hour, req.end_hour);
  const modifier = req.mode === "adjust" ? 1 + (req.bid_adjust_pct ?? 0) / 100 : null;
  const out: ScheduleEntry[] = [];

  for (const day of WEEK) {
    // One slot per hour: a modifier, or null for "no ads at this hour".
    let slots: (number | null)[] = Array.from({ length: 24 }, (_, h) =>
      req.days.includes(day) && band.has(h) ? modifier : 1
    );

    let runs = compress(slots);
    // Over Google's per-day limit: give back the weakest adjustment first.
    while (runs.length > MAX_PER_DAY) {
      const adjustable = runs
        .filter((r) => r.mod !== null && r.mod !== 1)
        .sort((a, b) => Math.abs(a.mod! - 1) - Math.abs(b.mod! - 1));
      if (!adjustable.length) break;
      const weakest = adjustable[0];
      slots = slots.map((m, h) => (h >= weakest.start && h < weakest.end ? 1 : m));
      runs = compress(slots);
    }

    for (const r of runs) {
      if (r.mod === null) continue;
      out.push({ day, startHour: r.start, endHour: r.end, bidModifier: Math.round(r.mod * 100) / 100 });
    }
  }
  return out;
}

function compress(slots: (number | null)[]) {
  const runs: { start: number; end: number; mod: number | null }[] = [];
  for (let h = 0; h < 24; h++) {
    const last = runs[runs.length - 1];
    if (last && last.mod === slots[h]) last.end = h + 1;
    else runs.push({ start: h, end: h + 1, mod: slots[h] });
  }
  return runs;
}
