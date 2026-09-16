"use client";

import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";

const style = { background: "none", border: 0, font: "inherit", cursor: "pointer", textAlign: "left" } as const;

/** Signing out ends both gates: the person's Clerk session, then the shared password. */
function ClerkSignOut({ children }: { children: React.ReactNode }) {
  const { signOut } = useClerk();
  return (
    <button className="side-link" style={style} onClick={async () => {
      await signOut();
      await fetch("/api/login", { method: "DELETE" });
      window.location.href = "/login";
    }}>{children}</button>
  );
}

function PasswordSignOut({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <button className="side-link" style={style} onClick={async () => {
      await fetch("/api/login", { method: "DELETE" });
      router.replace("/login");
      router.refresh();
    }}>{children}</button>
  );
}

export function SignOut({ identity, children }: { identity: boolean; children: React.ReactNode }) {
  return identity ? <ClerkSignOut>{children}</ClerkSignOut> : <PasswordSignOut>{children}</PasswordSignOut>;
}
