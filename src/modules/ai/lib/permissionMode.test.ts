import { describe, expect, it } from "vitest";
import {
  autoApprovesEdits,
  autoApprovesEverything,
  PERMISSION_MODES,
} from "./permissionMode";

describe("autoApprovesEdits", () => {
  it("auto-approves under accept-edits and auto", () => {
    expect(autoApprovesEdits("accept-edits")).toBe(true);
    expect(autoApprovesEdits("auto")).toBe(true);
  });

  it("still asks under manual and plan", () => {
    expect(autoApprovesEdits("manual")).toBe(false);
    expect(autoApprovesEdits("plan")).toBe(false);
  });

  it("covers every declared mode", () => {
    for (const mode of PERMISSION_MODES) {
      expect(typeof autoApprovesEdits(mode)).toBe("boolean");
    }
  });
});

describe("autoApprovesEverything", () => {
  it("is true only for auto", () => {
    expect(autoApprovesEverything("auto")).toBe(true);
    expect(autoApprovesEverything("manual")).toBe(false);
    expect(autoApprovesEverything("accept-edits")).toBe(false);
    expect(autoApprovesEverything("plan")).toBe(false);
  });
});
