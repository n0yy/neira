import { describe, expect, it } from "vitest";
import {
  AI_DOCK_DEFAULT_WIDTH,
  AI_DOCK_MAX_WIDTH,
  AI_DOCK_MIN_WIDTH,
  clampAiDockWidth,
  shouldPersistAiDockWidth,
} from "./aiDockGeometry";

describe("aiDockGeometry", () => {
  it("has correct defaults and bounds", () => {
    expect(AI_DOCK_DEFAULT_WIDTH).toBe(380);
    expect(AI_DOCK_MIN_WIDTH).toBe(320);
    expect(AI_DOCK_MAX_WIDTH).toBe(540);
    expect(AI_DOCK_DEFAULT_WIDTH).toBeGreaterThanOrEqual(AI_DOCK_MIN_WIDTH);
    expect(AI_DOCK_DEFAULT_WIDTH).toBeLessThanOrEqual(AI_DOCK_MAX_WIDTH);
  });

  it("shouldPersistAiDockWidth only persists positive width from user interaction", () => {
    expect(shouldPersistAiDockWidth(380, true)).toBe(true);
    expect(shouldPersistAiDockWidth(380, false)).toBe(false);
    expect(shouldPersistAiDockWidth(0, true)).toBe(false);
    expect(shouldPersistAiDockWidth(-10, true)).toBe(false);
  });

  it("clampAiDockWidth clamps to [320,540] and rounds", () => {
    expect(clampAiDockWidth(100)).toBe(AI_DOCK_MIN_WIDTH);
    expect(clampAiDockWidth(1000)).toBe(AI_DOCK_MAX_WIDTH);
    expect(clampAiDockWidth(400.6)).toBe(401);
    expect(clampAiDockWidth(380)).toBe(380);
  });
});
