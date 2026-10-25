/**
 * Page bookkeeping for the NVL layout (theme preset "nvl").
 *
 * In NVL the paragraphs of a turn stack on a page: the earlier ones stay
 * (dimmed) and the new one types beneath them. When a paragraph would
 * overflow the page, the page clears and it starts the next one. The stage
 * lays a page out and measures it; this module remembers where pages start,
 * so Previous shows a paragraph on the same page it was read on, and says
 * which paragraphs a page shows. Paragraph indices are the turn's (the
 * reader's own line, appended to the turn, is one more paragraph).
 */
export class NvlPages {
  /** First paragraph of every page so far, ascending; always starts with 0. */
  private starts: number[] = [0];

  /** A new turn: one page, from its first paragraph. */
  reset(): void {
    this.starts = [0];
  }

  /** First paragraph of the page that shows paragraph `index`. */
  startOf(index: number): number {
    let start = 0;
    for (const value of this.starts) {
      if (value > index) break;
      start = value;
    }
    return start;
  }

  /** Paragraphs shown above `index` on its page, in reading order. */
  earlierOn(index: number): number[] {
    const earlier: number[] = [];
    for (let at = this.startOf(index); at < index; at += 1) earlier.push(at);
    return earlier;
  }

  /** Paragraph `index` did not fit under the ones before it: it starts a page. */
  breakAt(index: number): void {
    if (!Number.isInteger(index) || index <= 0 || this.starts.includes(index)) return;
    this.starts.push(index);
    this.starts.sort((left, right) => left - right);
  }

  /**
   * The page for paragraph `index`, as its first paragraph. `fits(start,
   * index)` says whether paragraphs start..index fit on one page (the stage
   * lays them out and measures); when they do not, `index` starts a new page.
   * A paragraph alone on its page always "fits": a long one scrolls inside
   * its box as in every layout.
   */
  place(index: number, fits: (start: number, index: number) => boolean): number {
    const start = this.startOf(index);
    if (start >= index || fits(start, index)) return start;
    this.breakAt(index);
    return index;
  }

  /** Page starts so far (tests, diagnostics). */
  snapshot(): readonly number[] {
    return [...this.starts];
  }
}
