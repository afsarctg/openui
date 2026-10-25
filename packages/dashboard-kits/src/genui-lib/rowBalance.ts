import { useEffect } from "react";

/**
 * Keeps generated dashboards free of half-empty cards.
 *
 * A base CardRow stretches its cards to the tallest one. The gallery pairs
 * cards of similar height, but a model writing a dashboard cannot know heights,
 * and often puts a short card (a funnel, a few bars) beside a long table. A
 * filling chart takes up some of the slack, to its maximum height. When a card
 * would still be left with a large blank below its content, the row stacks:
 * every card takes the full width, so none is stretched over empty space.
 *
 * One balancer watches every `.kit-theme .c1-card-row` on the page. A stacked
 * row stays stacked until the window width changes, so the layout never flips
 * back and forth as heights settle.
 */

const ROW = ".kit-theme .c1-card-row";
const STACKED = "kit-row--stacked";
/** Blank height a card may keep below its content before its row stacks. */
const MAX_BLANK = 140;
/** …and the share of the row height that blank may be. */
const MAX_BLANK_SHARE = 0.25;

let started = false;

/** Starts the page's row balancer (once) when a kit component mounts. */
export function useRowBalance() {
  useEffect(startRowBalance, []);
}

function startRowBalance() {
  if (started || typeof window === "undefined" || typeof ResizeObserver === "undefined") return;
  started = true;

  const observed = new WeakSet<Element>();
  const dirty = new Set<Element>();
  let frame = 0;
  let scanQueued = false;

  const flush = () => {
    frame = 0;
    if (scanQueued) {
      scanQueued = false;
      scan();
    }
    for (const row of dirty) if (row.isConnected) balance(row);
    dirty.clear();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const row = entry.target.closest(ROW);
      if (row) dirty.add(row);
    }
    schedule();
  });

  // Watch each card and each block of its body: a short card keeps the row's
  // height when its content grows, so only its blocks report the change.
  function scan() {
    for (const row of document.querySelectorAll(ROW)) {
      for (const card of cardsOf(row)) {
        for (const el of [card, ...bodyOf(card).children]) {
          if (observed.has(el)) continue;
          observed.add(el);
          resize.observe(el);
          dirty.add(row);
        }
      }
    }
  }

  new MutationObserver(() => {
    scanQueued = true;
    schedule();
  }).observe(document.body, { childList: true, subtree: true });

  let width = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    for (const row of document.querySelectorAll(`${ROW}.${STACKED}`)) {
      row.classList.remove(STACKED);
      dirty.add(row);
    }
    schedule();
  });

  scan();
  schedule();
}

function cardsOf(row: Element): HTMLElement[] {
  return [...row.children].filter(
    (c): c is HTMLElement =>
      c instanceof HTMLElement &&
      c.classList.contains("c1-shell-card") &&
      !c.classList.contains("c1-shell-card--small"),
  );
}

function bodyOf(card: Element): Element {
  return card.querySelector(":scope > .c1-shell-card__content-wrap") ?? card;
}

/** Stacks the row when a card in it would sit over a large blank. */
function balance(row: Element) {
  if (row.classList.contains(STACKED)) return;
  const cards = cardsOf(row);
  if (cards.length < 2) return;
  // Only cards side by side: a row that already wraps has nothing to balance.
  const tops = cards.map((c) => c.getBoundingClientRect().top);
  if (Math.max(...tops) - Math.min(...tops) > 2) return;

  const measured = cards.map(measure);
  const tallest = Math.max(...measured.map((m) => m.natural));
  if (tallest <= 0) return;
  const blank = (m: Measure) => tallest - m.natural - m.room;
  if (measured.some((m) => blank(m) > Math.max(MAX_BLANK, tallest * MAX_BLANK_SHARE))) {
    row.classList.add(STACKED);
  }
}

interface Measure {
  /** The card's height with its content at its own size, nothing stretched. */
  natural: number;
  /** How much its filling charts can still grow. */
  room: number;
}

function measure(card: HTMLElement): Measure {
  const box = card.getBoundingClientRect();
  let bottom = box.top;
  // The lowest content, looking inside blocks stretched to the card's bottom.
  const walk = (el: Element, depth: number) => {
    for (const child of el.children) {
      const b = child.getBoundingClientRect();
      if (b.height === 0) continue;
      if (depth < 5 && b.bottom > box.bottom - 24 && child.children.length > 0)
        walk(child, depth + 1);
      else bottom = Math.max(bottom, b.bottom);
    }
  };
  walk(bodyOf(card), 0);

  let grown = 0;
  let room = 0;
  for (const frame of card.querySelectorAll<HTMLElement>(
    "[data-kit-fill] [class*='-frame--fill']",
  )) {
    const min = parseFloat(frame.style.minHeight) || 0;
    const max = parseFloat(frame.style.maxHeight) || Infinity;
    grown += Math.max(0, frame.offsetHeight - min);
    room += Math.max(0, max - min);
  }
  const padding = parseFloat(getComputedStyle(card).paddingBottom) || 0;
  return { natural: bottom - box.top + padding - grown, room };
}
