import { NextResponse, type NextRequest } from "next/server";
import { answer } from "@/lib/brain/chat";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client, "view");
  if (client instanceof NextResponse) return client;
  const question = String(b?.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "Ask something." }, { status: 400 });
  try {
    const history = Array.isArray(b?.history)
      ? b.history.filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      : [];
    return NextResponse.json({ answer: await answer(client.id, question.slice(0, 2000), history) });
  } catch (err) {
    return failure(err);
  }
}
