import { describe, expect, it } from "vitest";
import type { UserConfig } from "vite";
import config from "../vite.config";

describe("development coordinate reload boundary", () => {
  it("does not reload the active UI when regenerated browser data changes", () => {
    const ignored = (config as UserConfig).server?.watch?.ignored;

    expect(ignored).toEqual(
      expect.arrayContaining([
        "**/data/generated/**",
        "**/data/reports/**",
        "**/public/data/**",
      ]),
    );
  });
});
