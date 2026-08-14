import { afterEach, describe, expect, it, vi } from "vitest";

const contentResponse = (url: string, status = 200) =>
  new Response(
    JSON.stringify({
      schema_version: url.includes("coverage-ledger") ? "1.1.0" : "1.0.0",
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("course content loading", () => {
  it("loads startup content from the same-origin static files", async () => {
    vi.stubEnv("VITE_BACKEND_BASE_URL", "https://backend.example");
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        return contentResponse(url);
      }),
    );
    const { loadCoreLearningData } = await import("./content");

    await loadCoreLearningData();

    expect(requested).toEqual([
      "/api/content/learning-content.json",
      "/api/content/coverage-ledger.json",
    ]);
  });

  it("falls back to the content backend when a static file is unavailable", async () => {
    vi.stubEnv("VITE_BACKEND_BASE_URL", "https://backend.example");
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        return contentResponse(url, url.startsWith("/") ? 404 : 200);
      }),
    );
    const { loadCoreLearningData } = await import("./content");

    await loadCoreLearningData();

    expect(requested).toEqual([
      "/api/content/learning-content.json",
      "/api/content/coverage-ledger.json",
      "https://backend.example/api/content/learning-content.json",
      "https://backend.example/api/content/coverage-ledger.json",
    ]);
  });
});
