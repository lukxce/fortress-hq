import { LoginForm } from "@/components/LoginForm";
import { passwordConfigured } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  if (!passwordConfigured()) {
    return (
      <div className="gate">
        <div className="sheet sheet-pad rise" style={{ maxWidth: 460 }}>
          <h1 style={{ marginBottom: 10 }}>No password set</h1>
          <p>
            Set <code>APP_PASSWORD</code> to at least eight characters, then restart.
            Until then the app will not serve, because a deployed URL with no lock
            is open to anyone who finds it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <LoginForm next={next ?? "/overview"} />
    </div>
  );
}
