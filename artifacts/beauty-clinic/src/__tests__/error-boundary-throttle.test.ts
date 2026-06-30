import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  shouldReport,
  __resetReportThrottle,
} from "@/components/error-boundary";

// Mirrors REPORT_THROTTLE_MS in components/error-boundary.tsx.
const THROTTLE_MS = 30_000;

let now = 0;

beforeEach(() => {
  now = 1_000_000;
  __resetReportThrottle();
  // shouldReport reads Date.now(); drive it deterministically.
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client-side crash-report throttle (shouldReport)", () => {
  it("allows the first report for a signature", () => {
    expect(shouldReport("Boom\nhttps://app/patients")).toBe(true);
  });

  it("suppresses an identical signature within the window", () => {
    expect(shouldReport("Boom\nhttps://app/patients")).toBe(true);
    // Same signature, no time elapsed -> dropped.
    expect(shouldReport("Boom\nhttps://app/patients")).toBe(false);
    // Still within the window after some time passes -> still dropped.
    now += THROTTLE_MS - 1;
    expect(shouldReport("Boom\nhttps://app/patients")).toBe(false);
  });

  it("allows a distinct signature within the window", () => {
    expect(shouldReport("Boom\nhttps://app/patients")).toBe(true);
    // Different page (url) -> distinct signature, allowed.
    expect(shouldReport("Boom\nhttps://app/staff")).toBe(true);
    // Different message, same page -> distinct signature, allowed.
    expect(shouldReport("Different\nhttps://app/patients")).toBe(true);
  });

  it("allows the same signature again after the window elapses", () => {
    expect(shouldReport("Boom\nhttps://app/patients")).toBe(true);
    // Advance just past the throttle window (condition is strictly `<`).
    now += THROTTLE_MS + 1;
    expect(shouldReport("Boom\nhttps://app/patients")).toBe(true);
  });
});
