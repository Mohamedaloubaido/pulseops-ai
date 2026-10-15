import assert from "node:assert/strict";
import test from "node:test";
import { cosineSimilarity } from "../src/ai/vector.js";

test("cosineSimilarity returns 1 for identical vectors", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test("cosineSimilarity ranks orthogonal vectors at zero", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity handles opposite vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test("cosineSimilarity fails closed for invalid dimensions and zero vectors", () => {
  assert.equal(cosineSimilarity([1, 2], [1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});
