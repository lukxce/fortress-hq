import { notFound } from "next/navigation";
import { clientWithProperties } from "@/lib/binding";

/** Resolve a client for a page through the signed-in user's scope, or 404. */
export async function pageClient(params: Promise<{ id: string }>) {
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId)) notFound();
  const client = await clientWithProperties(clientId);
  if (!client) notFound();
  return client;
}
