import assert from "node:assert";
import { test } from "node:test";
import { sum } from "../src/sum.js";

test("sum soma dois números", () => {
  assert.equal(sum(1, 2), 3);
});
