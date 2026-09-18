import { test } from "node:test";
import assert from "node:assert/strict";
import { salvageRecommendations } from "../lib/brain/salvage";

test("keeps complete recommendations from a cut-off answer", () => {
  const cut = '{"summary":"Tracking is broken \\"first\\".","recommendations":[{"title":"A","steps":["x"]},{"title":"B {not a brace}","steps":["y"]},{"title":"C","ste';
  const r = salvageRecommendations(cut)!;
  assert.equal(r.summary, 'Tracking is broken "first".');
  assert.deepEqual(r.recommendations.map((x: any) => x.title), ["A", "B {not a brace}"]);
});

test("returns everything from a complete answer", () => {
  const r = salvageRecommendations('{"summary":"ok","recommendations":[{"title":"A"}]}')!;
  assert.equal(r.recommendations.length, 1);
});

test("nothing usable yields null", () => {
  assert.equal(salvageRecommendations('{"summ'), null);
});
