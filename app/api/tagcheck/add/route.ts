import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { body, failure, scopedClient } from "@/lib/api";
import { addGoogleTag } from "@/lib/tracking/addtag";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Add a missing Google tag to the Tag Manager workspace. Not published: that stays a person's decision. */
export async function POST(req: NextRequest) {
  const parsed = z.object({ client: z.number().int(), product: z.enum(["ads", "analytics"]) }).safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: "Pass client and product." }, { status: 400 });
  const client = await scopedClient(parsed.data.client);
  if (client instanceof NextResponse) return client;
  try {
    return NextResponse.json(await addGoogleTag(client.id, parsed.data.product));
  } catch (err) {
    return failure(err);
  }
}
