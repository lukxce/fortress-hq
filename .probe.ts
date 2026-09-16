import { computeFindings, monthlyImpact } from "@/lib/engine/findings";
import { brandTerms } from "@/lib/engine/brand";
(async () => {
  console.log("brand terms:", await brandTerms(1));
  const f = await computeFindings(1);
  for (const x of f) console.log(`${x.severity.padEnd(8)} ${(x.area ?? "").padEnd(12)} ${x.kind.padEnd(28)} ${monthlyImpact(x).toFixed(0).padStart(6)}/mo  ${x.title}`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
