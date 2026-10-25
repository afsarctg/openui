// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { createLibrary, defineComponent } from "../library";
import { Renderer } from "../Renderer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Child throws while `failing` is set. It reads that from module state, not
// its props, the way a component throws on data from context or a query.
let failing = false;
let renders = 0;
const CAP = 2000;

const Child = defineComponent({
  name: "Child",
  props: z.object({ label: z.string() }),
  description: "Child",
  component: ({ props }) => {
    renders++;
    if ((failing || props.label === "bad") && renders < CAP) throw new Error("child broke");
    return createElement("span", null, props.label);
  },
});
const Card = defineComponent({
  name: "Card",
  props: z.object({ children: z.array(z.any()) }),
  description: "Card",
  component: ({ props, renderNode }) => createElement("div", null, renderNode(props.children)),
});
const library = createLibrary({ root: "Card", components: [Card, Child] });
const response = 'root = Card([child])\nchild = Child("hello")';

beforeEach(() => {
  failing = false;
  renders = 0;
});

describe("ElementErrorBoundary", () => {
  it("does not loop when a component always throws", () => {
    failing = true;
    const el = document.createElement("div");
    act(() => createRoot(el).render(createElement(Renderer, { response, library })));
    expect(renders).toBeLessThan(10);
  });

  it("does not loop when a component starts throwing after a good render", () => {
    const el = document.createElement("div");
    const root = createRoot(el);
    act(() => root.render(createElement(Renderer, { response, library, isStreaming: false })));
    expect(el.textContent).toBe("hello");
    failing = true;
    renders = 0;
    act(() =>
      root.render(
        createElement(Renderer, { response, library, isStreaming: false, onError: () => {} }),
      ),
    );
    expect(renders).toBeLessThan(10);
  });

  it("does not loop when the host stores reported errors in state", () => {
    failing = true;
    let reports = 0;
    function Host() {
      const [, setErrors] = useState<unknown[]>([]);
      return createElement(Renderer, {
        response,
        library,
        onError: (errors) => {
          reports++;
          setErrors(errors);
        },
      });
    }
    const el = document.createElement("div");
    act(() => createRoot(el).render(createElement(Host)));
    expect(renders).toBeLessThan(10);
    expect(reports).toBeLessThan(5);
  });

  it("retries a failed component when an ancestor keeps re-rendering, but boundedly", () => {
    failing = true;
    function Ticker() {
      const [tick, setTick] = useState(0);
      useEffect(() => {
        if (tick < 50) setTick(tick + 1);
      }, [tick]);
      return createElement(Renderer, { response, library });
    }
    const el = document.createElement("div");
    act(() => createRoot(el).render(createElement(Ticker)));
    // One retry per ancestor render would be 50+; a failed component should not
    // be retried until something that could change its outcome changes.
    expect(renders).toBeLessThan(10);
  });

  it("recovers when a later streamed chunk fixes the props", () => {
    const el = document.createElement("div");
    const root = createRoot(el);
    const broken = 'root = Card([child])\nchild = Child("bad")';
    act(() =>
      root.render(createElement(Renderer, { response: broken, library, isStreaming: true })),
    );
    act(() => root.render(createElement(Renderer, { response, library, isStreaming: true })));
    expect(el.textContent).toBe("hello");
  });

  it("recovers when the response changes after a failure", () => {
    failing = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    act(() => root.render(createElement(Renderer, { response, library })));
    expect(el.textContent).toBe("");
    failing = false;
    const next = 'root = Card([child])\nchild = Child("again")';
    act(() => root.render(createElement(Renderer, { response: next, library })));
    expect(el.textContent).toBe("again");
  });
});
