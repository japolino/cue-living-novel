import { describe, expect, test } from "bun:test";
import { NvlPages } from "./nvl-page";

/** A page that holds `capacity` lines; paragraph i takes heights[i] lines. */
const fitsIn = (heights: readonly number[], capacity: number) => (start: number, index: number): boolean => {
  let used = 0;
  for (let at = start; at <= index; at += 1) used += heights[at]!;
  return used <= capacity;
};

describe("NvlPages", () => {
  test("paragraphs stack on one page while they fit", () => {
    const pages = new NvlPages();
    const fits = fitsIn([2, 2, 2], 10);
    expect([0, 1, 2].map((index) => pages.place(index, fits))).toEqual([0, 0, 0]);
    expect(pages.earlierOn(2)).toEqual([0, 1]);
    expect(pages.snapshot()).toEqual([0]);
  });

  test("a paragraph that would overflow the page clears it and starts the next", () => {
    const pages = new NvlPages();
    const fits = fitsIn([3, 3, 3, 3, 3], 7);
    expect([0, 1, 2, 3, 4].map((index) => pages.place(index, fits))).toEqual([0, 0, 2, 2, 4]);
    expect(pages.snapshot()).toEqual([0, 2, 4]);
    expect(pages.earlierOn(2)).toEqual([]);
    expect(pages.earlierOn(3)).toEqual([2]);
  });

  test("Previous shows a paragraph on the page it was read on", () => {
    const pages = new NvlPages();
    const fits = fitsIn([3, 3, 3, 3, 3], 7);
    for (let index = 0; index <= 4; index += 1) pages.place(index, fits);
    // Back one paragraph at a time from the last page.
    expect(pages.place(3, fits)).toBe(2);
    expect(pages.earlierOn(3)).toEqual([2]);
    expect(pages.place(2, fits)).toBe(2);
    expect(pages.earlierOn(2)).toEqual([]);
    expect(pages.place(1, fits)).toBe(0);
    expect(pages.earlierOn(1)).toEqual([0]);
    // And forward again: the same pages, no new breaks.
    expect([2, 3, 4].map((index) => pages.place(index, fits))).toEqual([2, 2, 4]);
    expect(pages.snapshot()).toEqual([0, 2, 4]);
  });

  test("a paragraph alone on its page is never measured", () => {
    const pages = new NvlPages();
    let calls = 0;
    const never = () => { calls += 1; return false; };
    expect(pages.place(0, never)).toBe(0);
    expect(calls).toBe(0);
    expect(pages.place(1, never)).toBe(1);
    expect(calls).toBe(1);
    // Paragraph 1 now starts its page: back on it, nothing to measure.
    expect(pages.place(1, never)).toBe(1);
    expect(calls).toBe(1);
  });

  test("a page that no longer fits (a smaller screen) breaks again", () => {
    const pages = new NvlPages();
    for (let index = 0; index <= 3; index += 1) pages.place(index, fitsIn([2, 2, 2, 2], 10));
    expect(pages.snapshot()).toEqual([0]);
    const smaller = fitsIn([2, 2, 2, 2], 5);
    expect(pages.place(2, smaller)).toBe(2);
    expect(pages.place(3, smaller)).toBe(2);
    expect(pages.earlierOn(1)).toEqual([0]);
  });

  test("the reader's own line stacks under the turn like any paragraph", () => {
    const pages = new NvlPages();
    const fits = fitsIn([2, 2, 1], 6);
    for (let index = 0; index <= 1; index += 1) pages.place(index, fits);
    // presentUserParagraph appends paragraph 2 to the turn.
    expect(pages.place(2, fits)).toBe(0);
    expect(pages.earlierOn(2)).toEqual([0, 1]);
  });

  test("a new turn starts from a fresh page", () => {
    const pages = new NvlPages();
    const fits = fitsIn([3, 3, 3], 4);
    for (let index = 0; index <= 2; index += 1) pages.place(index, fits);
    expect(pages.snapshot()).toEqual([0, 1, 2]);
    pages.reset();
    expect(pages.snapshot()).toEqual([0]);
    expect(pages.startOf(2)).toBe(0);
  });

  test("breaks ignore the first paragraph, duplicates and bad input", () => {
    const pages = new NvlPages();
    pages.breakAt(0);
    pages.breakAt(-1);
    pages.breakAt(1.5);
    pages.breakAt(3);
    pages.breakAt(3);
    pages.breakAt(1);
    expect(pages.snapshot()).toEqual([0, 1, 3]);
    expect(pages.startOf(2)).toBe(1);
    expect(pages.startOf(7)).toBe(3);
  });
});
