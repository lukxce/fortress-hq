import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildGuided } from "@/lib/builder/guided";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

const Input = z.object({
  client: z.number().int(),
  goal: z.enum(["calls", "leads", "sales"]),
  places: z.array(z.object({ id: z.string(), name: z.string() })).min(1).max(20),
  monthlyBudget: z.number().positive(),
  website: z.string().url(),
});

/** Three answers in, a whole proposed campaign out, saved as a draft. */
export async function POST(req: NextRequest) {
  const parsed = Input.safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the answers." }, { status: 400 });
  const client = await scopedClient(parsed.data.client);
  if (client instanceof NextResponse) return client;
  try {
    const { client: _, ...input } = parsed.data;
    return NextResponse.json(await buildGuided(client.id, input));
  } catch (err) {
    return failure(err, 400);
  }
}
