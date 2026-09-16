import { NextResponse, type NextRequest } from "next/server";
import { previewAction, applyAction } from "@/lib/actions/apply";
import { body, failure, scopedClient } from "@/lib/api";
import { currentUser } from "@/lib/user";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * mode "preview": validate against the live account and return the summary
 * that names the change and the money, plus a token for exactly that action.
 * mode "apply": run the action the token was issued for, and nothing else.
 */
export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  try {
    if (b?.mode === "preview") {
      const v = await previewAction(client.id, b.action);
      return NextResponse.json(v, { status: v.ok ? 200 : 422 });
    }
    if (b?.mode === "apply") {
      const user = await currentUser();
      const out = await applyAction({
        clientId: client.id, userId: user?.id ?? null, action: b.action, token: b.token,
        recommendationId: b.recommendationId ?? null,
      });
      return NextResponse.json({ ok: true, ...out });
    }
    return NextResponse.json({ error: "mode must be preview or apply" }, { status: 400 });
  } catch (err) {
    return failure(err, 400);
  }
}
