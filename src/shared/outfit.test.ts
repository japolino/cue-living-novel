import assert from "node:assert/strict";
import test from "node:test";
import { parseOutfit, sameOutfit } from "./outfit.js";

const APRON = "dark green bib apron, white collared shirt, black slacks";
const APRON_TIGHT = "dark green bib apron, tight white collared shirt, fitted black slacks";
const KNIT = "oversized knit sweater under a green café bib apron, fitted black slacks";
const APRON_SHORTS = "white collared shirt, green bib apron, black shorts";
const BUTTON_SOCKS = "white button-down shirt, unbuttoned collar, black shorts, dark socks";
const BUTTON = "white button-down shirt, black shorts";

test("Rin: a reworded café outfit is the same outfit", () => {
  assert.equal(sameOutfit(APRON, APRON_TIGHT), true);
  assert.equal(sameOutfit(APRON, APRON_SHORTS), true);
  assert.equal(sameOutfit(APRON_TIGHT, APRON_SHORTS), true);
});

test("Rin: a knit sweater under the apron is a different outfit", () => {
  assert.equal(sameOutfit(APRON_TIGHT, KNIT), false);
  assert.equal(sameOutfit(APRON, KNIT), false);
  assert.equal(sameOutfit(KNIT, APRON_SHORTS), false);
});

test("Rin: button-down and shorts, with or without socks and collar state", () => {
  assert.equal(sameOutfit(BUTTON_SOCKS, BUTTON), true);
  assert.equal(sameOutfit(BUTTON, APRON_SHORTS), false);
  assert.equal(sameOutfit(BUTTON_SOCKS, APRON), false);
});

test("rat girl: hoodie is not a t-shirt; the t-shirt and pajama variants are one outfit", () => {
  assert.equal(sameOutfit("oversized faded gray hoodie, bare legs", "oversized cotton t-shirt off one shoulder, gray pajama shorts"), false);
  const variants = [
    "oversized cotton graphic t-shirt slipping off one shoulder, thin gray pajama shorts",
    "oversized cotton t-shirt off-shoulder, short pajama bottoms",
    "oversized white graphic t-shirt slipping off one shoulder, short gray pajama shorts",
    "oversized cotton t-shirt off one shoulder, gray pajama shorts",
  ];
  for (const a of variants) for (const b of variants) assert.equal(sameOutfit(a, b), true, `${a} | ${b}`);
});

test("colours: a conflict per category is a different outfit; shades and spellings match", () => {
  assert.equal(sameOutfit("red dress", "blue dress"), false);
  assert.equal(sameOutfit("grey hoodie", "gray hoodie"), true);
  assert.equal(sameOutfit("dark green apron", "green apron"), true);
  assert.equal(sameOutfit("white blouse, navy skirt", "blouse, skirt"), true);
  assert.equal(sameOutfit("white blouse, navy skirt", "white blouse, navy shorts"), false);
});

test("categories: swimwear, sleepwear, nude and uniform", () => {
  assert.equal(sameOutfit("red bikini top, red bikini bottoms", "red bikini"), true);
  assert.equal(sameOutfit("pink pajamas", "pink pajamas, fluffy slippers"), true);
  assert.equal(sameOutfit("naked", "nude"), true);
  assert.equal(sameOutfit("school uniform", "school uniform, red ribbon"), true);
  assert.equal(sameOutfit("cafe uniform (white button-down, black shorts)", BUTTON), true);
  assert.equal(sameOutfit("white shirt, black skirt", "white shirt, black shorts"), false);
  assert.equal(sameOutfit("shirt, jeans", "shirt, jeans, leather jacket"), false);
});

test("no recognised garment: normalised text equality", () => {
  assert.equal(parseOutfit("her usual look").known, false);
  assert.equal(sameOutfit("Her usual look", "her usual  look."), true);
  assert.equal(sameOutfit("her usual look", "festival look"), false);
  assert.equal(sameOutfit(null, ""), true);
  assert.equal(sameOutfit(null, BUTTON), false);
});
