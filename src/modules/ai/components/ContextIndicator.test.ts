import { describe, expect, it } from "vitest";
import { compatModelIdForEndpoint } from "../config";
import { resolveContextMax } from "./ContextIndicator";

describe("resolveContextMax", () => {
  // Reproduces: DGX Spark custom endpoint has Context = 262144 in
  // Settings -> Models, but the context indicator showed 128K (the
  // fallback) regardless.
  it("uses the matching custom endpoint's own contextLimit, not the legacy single-endpoint fallback", () => {
    const endpointId = "dgx-spark";
    const modelId = compatModelIdForEndpoint(endpointId);
    const customEndpoints = [
      {
        id: endpointId,
        name: "DGX Spark",
        baseURL: "http://100.75.49.117:4000/v1",
        modelId: "qwen3.8-flash-next",
        contextLimit: 262_144,
      },
    ];

    const max = resolveContextMax(modelId, customEndpoints, 128_000);

    expect(max).toBe(262_144);
  });

  it("falls back to the legacy single-endpoint limit when no named endpoint matches", () => {
    const max = resolveContextMax("compat-unknown", [], 128_000);
    expect(max).toBe(128_000);
  });
});
