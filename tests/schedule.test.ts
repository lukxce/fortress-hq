// Run with: npx tsx tests/schedule.test.ts
import { fullWeekSchedule, hoursInBand, WEEK, type ScheduleRequest } from "../lib/actions/schedule";

let failures = 0;
function check(name: string, req: ScheduleRequest) {
  const entries = fullWeekSchedule(req);
  const band = hoursInBand(req.start_hour, req.end_hour);
  for (const day of WEEK) {
    const mine = entries.filter((e) => e.day === day);
    const covered = new Array(24).fill(0);
    for (const e of mine) for (let h = e.startHour; h < e.endHour; h++) covered[h]++;
    const excludedHere = req.mode === "exclude" && req.days.includes(day);
    for (let h = 0; h < 24; h++) {
      const shouldBeOff = excludedHere && band.has(h);
      const expected = shouldBeOff ? 0 : 1;
      if (covered[h] !== expected) {
        failures++;
        console.log(`FAIL ${name}: ${day} ${h}:00 covered ${covered[h]}x, expected ${expected}`);
      }
    }
    if (mine.length > 6) { failures++; console.log(`FAIL ${name}: ${day} has ${mine.length} entries`); }
    if (req.mode === "adjust" && req.days.includes(day)) {
      for (const h of band) {
        const e = mine.find((x) => h >= x.startHour && h < x.endHour);
        const want = Math.round((1 + (req.bid_adjust_pct ?? 0) / 100) * 100) / 100;
        if (e && e.bidModifier !== want) { failures++; console.log(`FAIL ${name}: ${day} ${h}:00 modifier ${e.bidModifier}, want ${want}`); }
      }
    }
  }
  console.log(`${failures ? "…" : "ok"}  ${name}: ${entries.length} entries`);
}

check("adjust 00-06 every day", { start_hour: 0, end_hour: 6, days: [...WEEK], mode: "adjust", bid_adjust_pct: -40 });
check("exclude 22-06 wrapping midnight", { start_hour: 22, end_hour: 6, days: [...WEEK], mode: "exclude" });
check("exclude 13-01 wrapping", { start_hour: 13, end_hour: 1, days: [...WEEK], mode: "exclude" });
check("adjust weekdays only 09-17", { start_hour: 9, end_hour: 17, days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"], mode: "adjust", bid_adjust_pct: 20 });
check("band ending at 24", { start_hour: 18, end_hour: 24, days: [...WEEK], mode: "exclude" });
check("single hour", { start_hour: 3, end_hour: 4, days: ["SUNDAY"], mode: "adjust", bid_adjust_pct: -90 });
check("adjust wrapping 20-08", { start_hour: 20, end_hour: 8, days: [...WEEK], mode: "adjust", bid_adjust_pct: -25 });

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall schedule cases pass");
