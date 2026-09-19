"use client";

import { useRouter } from "next/navigation";

export function FollowUpDone({ clientId, id }: { clientId: number; id: number }) {
  const router = useRouter();
  return (
    <button className="link-quiet" style={{ marginLeft: 8 }} onClick={async (e) => {
      e.preventDefault();
      await fetch("/api/followups", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: clientId, id, status: "done" }) });
      router.refresh();
    }}>Done</button>
  );
}
