import { describe, expect, it } from "vitest";
import { projectName } from "./version.js";

describe("projectName", () => {
  it("liefert den Projektnamen", () => {
    expect(projectName()).toBe("tiktok-ai-studio");
  });
});
