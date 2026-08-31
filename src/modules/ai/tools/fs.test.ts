import { describe, expect, it, vi } from "vitest";
import type { PermissionMode } from "../lib/permissionMode";
import type { ToolContext } from "./context";
import { resolveApproval } from "./testNeedsApproval";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));

vi.mock("../lib/security", () => ({
  checkReadableCanonical: vi.fn(async (path: string) => ({
    ok: true as const,
    canonical: path,
  })),
  checkWritableCanonical: vi.fn(async (path: string) => ({
    ok: true as const,
    canonical: path,
  })),
}));

import { buildFsTools } from "./fs";

function makeContext(mode: PermissionMode): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    readCache: new Map(),
    getSessionId: () => "session",
    getPermissionMode: () => mode,
  } as unknown as ToolContext;
}

describe("write_file/create_directory needsApproval", () => {
  it("asks under manual and plan", async () => {
    for (const mode of ["manual", "plan"] as const) {
      const { write_file, create_directory } = buildFsTools(makeContext(mode));
      expect(await resolveApproval(write_file.needsApproval)).toBe(true);
      expect(await resolveApproval(create_directory.needsApproval)).toBe(true);
    }
  });

  it("does not ask under accept-edits or auto", async () => {
    for (const mode of ["accept-edits", "auto"] as const) {
      const { write_file, create_directory } = buildFsTools(makeContext(mode));
      expect(await resolveApproval(write_file.needsApproval)).toBe(false);
      expect(await resolveApproval(create_directory.needsApproval)).toBe(
        false,
      );
    }
  });
});
