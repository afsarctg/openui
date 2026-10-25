import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { coerceArgs } from "./prompt";

describe("coerceArgs: numbers", () => {
  const input = z.object({
    weeks: z.number().int().min(4).max(10).default(8),
    share: z.number().min(0).max(1).optional(),
    label: z.string().optional(),
  });

  it("brings numbers inside their bounds and to whole numbers where wanted", () => {
    expect(coerceArgs(input, { weeks: 12 })).toEqual({ weeks: 10 });
    expect(coerceArgs(input, { weeks: 2 })).toEqual({ weeks: 4 });
    expect(coerceArgs(input, { weeks: 6.6, share: 1.4 })).toEqual({ weeks: 7, share: 1 });
  });

  it("reads a number sent as text, then bounds it", () => {
    expect(coerceArgs(input, { weeks: "12" })).toEqual({ weeks: 10 });
    expect(coerceArgs(input, { weeks: "6 weeks" })).toEqual({ weeks: 6 });
  });

  it("leaves everything else alone", () => {
    expect(coerceArgs(input, { weeks: 8, label: "x" })).toEqual({ weeks: 8, label: "x" });
    expect(coerceArgs(input, {})).toEqual({});
  });

  it("lets the schema still reject what is not a number", () => {
    expect(() => input.parse(coerceArgs(input, { weeks: "twelve" }))).toThrow();
  });
});

describe("coerceArgs: choices", () => {
  const input = z.object({
    range: z.enum(["7d", "30d", "90d", "mtd"]).default("30d"),
    view: z.enum(["weekly", "states"]).optional(),
    mode: z.enum(["a", "b"]),
  });

  it("maps periods to the nearest day-count option", () => {
    expect(coerceArgs(input, { range: "ytd" })).toEqual({ range: "90d" });
    expect(coerceArgs(input, { range: "12m" })).toEqual({ range: "90d" });
    expect(coerceArgs(input, { range: "2 weeks" })).toEqual({ range: "7d" });
    expect(coerceArgs(input, { range: "60d" })).toEqual({ range: "30d" });
    expect(coerceArgs(input, { range: "30D" })).toEqual({ range: "30d" });
  });

  it("falls back to the default, or drops an optional choice, when nothing fits", () => {
    expect(input.parse(coerceArgs(input, { range: "banana", mode: "a" })).range).toBe("30d");
    expect(coerceArgs(input, { view: "monthly", mode: "a" })).toEqual({ mode: "a" });
  });

  it("leaves a required choice to fail validation", () => {
    expect(() => input.parse(coerceArgs(input, { mode: "c" }))).toThrow();
  });
});

describe("coerceArgs: loose spellings, booleans, and lists", () => {
  const input = z.object({
    compare: z.enum(["previous_period", "last_year", "plan"]).default("previous_period"),
    cumulative: z.boolean().optional(),
    window: z.union([z.literal(7), z.literal(28)]).default(7),
    platforms: z.array(z.enum(["web", "ios", "android"])).optional(),
    steps: z.array(z.string()).optional(),
    strict: z.boolean(),
  });

  it("matches choices ignoring case, spaces, underscores, and hyphens", () => {
    expect(coerceArgs(input, { compare: "Previous period" })).toEqual({
      compare: "previous_period",
    });
    expect(coerceArgs(input, { compare: "last-year" })).toEqual({ compare: "last_year" });
    expect(coerceArgs(input, { compare: " PLAN " })).toEqual({ compare: "plan" });
  });

  it("reads booleans sent as text", () => {
    expect(coerceArgs(input, { cumulative: "true", strict: "No" })).toEqual({
      cumulative: true,
      strict: false,
    });
    expect(coerceArgs(input, { cumulative: "yes", strict: 0 })).toEqual({
      cumulative: true,
      strict: false,
    });
  });

  it("takes the first valid item when a list is sent for one choice", () => {
    expect(coerceArgs(input, { compare: ["banana", "Last year", "plan"] })).toEqual({
      compare: "last_year",
    });
    expect(coerceArgs(input, { window: ["28"] })).toEqual({ window: 28 });
  });

  it("matches numeric choices to the nearest option", () => {
    expect(coerceArgs(input, { window: "28" })).toEqual({ window: 28 });
    expect(coerceArgs(input, { window: 30 })).toEqual({ window: 28 });
  });

  it("wraps a single value where a list is expected, repairing each item", () => {
    expect(coerceArgs(input, { platforms: "iOS" })).toEqual({ platforms: ["ios"] });
    expect(coerceArgs(input, { platforms: "web, Android" })).toEqual({
      platforms: ["web", "android"],
    });
    expect(coerceArgs(input, { platforms: ["WEB", "ios"] })).toEqual({ platforms: ["web", "ios"] });
    expect(coerceArgs(input, { steps: "Created board" })).toEqual({ steps: ["Created board"] });
  });

  it("leaves what it can't repair for the schema to reject", () => {
    expect(() => input.parse(coerceArgs(input, { strict: "maybe" }))).toThrow();
    expect(() =>
      input.parse(coerceArgs(input, { strict: true, platforms: ["web", "windows"] })),
    ).toThrow();
    expect(() => input.parse(coerceArgs(input, { strict: true, steps: { a: 1 } }))).toThrow();
    expect(coerceArgs(input, { compare: ["banana"], strict: true })).toEqual({ strict: true });
  });
});
