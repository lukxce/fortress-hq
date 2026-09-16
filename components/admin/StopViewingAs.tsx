"use client";

export function StopViewingAs() {
  return (
    <button className="btn btn-sm" onClick={async () => {
      await fetch("/api/admin/view-as", { method: "DELETE" });
      window.location.href = "/admin/users";
    }}>Stop viewing as them</button>
  );
}
