import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("release workflow", () => {
  it("uses version 0.1.6 consistently in app metadata", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

    expect(packageJson.version).toBe("0.1.6");
    expect(tauriConfig.version).toBe("0.1.6");
  });

  it("publishes only Windows 32-bit and 64-bit targets", () => {
    const workflow = readFileSync(".github/workflows/build.yml", "utf8");

    expect(workflow).toContain('platform: "windows-latest"');
    expect(workflow).toContain('args: "--target x86_64-pc-windows-msvc"');
    expect(workflow).toContain('args: "--target i686-pc-windows-msvc"');
    expect(workflow).not.toContain('platform: "macos-latest"');
    expect(workflow).not.toContain('platform: "ubuntu-22.04"');
  });
});
