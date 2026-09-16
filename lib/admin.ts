import { NextResponse } from "next/server";
import { currentUser, isAdmin, type AppUser } from "@/lib/user";

/** For admin APIs: the admin, or a 404 that does not reveal the route exists. */
export async function adminOr404(): Promise<AppUser | NextResponse> {
  const u = await currentUser();
  if (!isAdmin(u)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return u!;
}
