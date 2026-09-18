/**
 * Recover what a cut-off JSON answer still holds.
 *
 * When a response stops mid-object (the token limit, or the function's time
 * limit), the complete recommendations before the cut are still good work.
 * This walks the "recommendations" array and returns every object that closed,
 * plus the summary if it was written before the array.
 */
export function salvageRecommendations(text: string): { summary?: string; recommendations: unknown[] } | null {
  const out: unknown[] = [];
  let summary: string | undefined;
  const s = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (s) { try { summary = JSON.parse(`"${s[1]}"`); } catch { /* keep none */ } }

  const key = text.indexOf('"recommendations"');
  if (key < 0) return summary ? { summary, recommendations: [] } : null;
  const open = text.indexOf("[", key);
  if (open < 0) return summary ? { summary, recommendations: [] } : null;

  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip a malformed one */ }
        start = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return { summary, recommendations: out };
}
