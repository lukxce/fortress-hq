import { q, q1 } from "@/lib/db";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await q1<{ value: T }>(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  return row ? row.value : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await q(`INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
}
