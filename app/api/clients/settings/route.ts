import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q } from "@/lib/db";
import { normalise } from "@/lib/engine/brand";
import { body, failure, scopedClient } from "@/lib/api";
import { INDUSTRIES } from "@/lib/learning/industry";

export const runtime = "nodejs";

const Settings = z.object({
  client: z.number().int(),
  brandTerms: z.array(z.string().max(60)).max(30).optional(),
  website: z.string().max(300).nullable().optional(),
  goalType: z.enum(["cpa", "roas"]).optional(),
  targetCpa: z.number().positive().nullable().optional(),
  targetRoas: z.number().positive().nullable().optional(),
  monthlyBudget: z.number().positive().nullable().optional(),
  industry: z.string().refine((v) => v in INDUSTRIES).optional(),
});

export async function PATCH(req: NextRequest) {
  const parsed = Settings.safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const s = parsed.data;
  const client = await scopedClient(s.client);
  if (client instanceof NextResponse) return client;
  try {
    if (s.industry) await q(`UPDATE clients SET industry = $2, industry_source = 'manual' WHERE id = $1`, [client.id, s.industry]);
    await q(`UPDATE clients SET
               brand_terms = COALESCE($2, brand_terms),
               website = CASE WHEN $3::boolean THEN $4 ELSE website END,
               goal_type = COALESCE($5, goal_type),
               target_cpa = CASE WHEN $6::boolean THEN $7 ELSE target_cpa END,
               target_roas = CASE WHEN $8::boolean THEN $9 ELSE target_roas END,
               monthly_budget = CASE WHEN $10::boolean THEN $11 ELSE monthly_budget END,
               updated_at = now()
             WHERE id = $1`,
      [client.id,
       s.brandTerms ? s.brandTerms.map(normalise).filter(Boolean) : null,
       s.website !== undefined, s.website ?? null,
       s.goalType ?? null,
       s.targetCpa !== undefined, s.targetCpa ?? null,
       s.targetRoas !== undefined, s.targetRoas ?? null,
       s.monthlyBudget !== undefined, s.monthlyBudget ?? null]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
