import { identityConfigured } from "@/lib/user";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  // Without an identity provider the shared password is the only gate, so
  // there is nothing here to sign in to — sending people to the app is more
  // honest than showing them a form that cannot work.
  if (!identityConfigured) redirect("/overview");
  const { SignIn } = await import("@clerk/nextjs");
  return (
    <div className="sheet sheet-pad" style={{ maxWidth: 460, margin: "40px auto" }}>
      <SignIn />
    </div>
  );
}
