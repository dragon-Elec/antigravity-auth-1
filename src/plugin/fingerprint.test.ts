import { beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  vi.resetModules()
})

describe("Antigravity fingerprint", () => {
  it("builds the captured agy CLI User-Agent with normalized platform and arch", async () => {
    const {
      buildAntigravityHarnessPlatformArch,
      buildAntigravityHarnessUserAgent,
    } = await import("./fingerprint.ts")

    expect(buildAntigravityHarnessPlatformArch("darwin", "arm64")).toBe("darwin/arm64")
    expect(buildAntigravityHarnessPlatformArch("win32", "x64")).toBe("windows/amd64")
    expect(buildAntigravityHarnessUserAgent("1.0.4", "darwin", "arm64")).toBe("antigravity/cli/1.0.4 darwin/arm64")
  })

  it("builds captured agy CLI loadCodeAssist headers", async () => {
    const { buildAntigravityHarnessBootstrapHeaders } = await import("./fingerprint.ts")

    const headers = buildAntigravityHarnessBootstrapHeaders("token")

    expect(headers).toEqual({
      "User-Agent": expect.stringMatching(/^antigravity\/cli\/1\.0\.4 .+$/),
      Authorization: "Bearer token",
      "Content-Type": "application/json",
      "Accept-Encoding": "gzip",
    })
    expect(headers["X-Goog-Api-Client"]).toBeUndefined()
    expect(headers["Client-Metadata"]).toBeUndefined()
  })

  it("generates fingerprints with the captured agy CLI User-Agent", async () => {
    const { buildAntigravityHarnessPlatformArch, generateFingerprint } = await import("./fingerprint.ts")

    const fingerprint = generateFingerprint()

    expect(fingerprint.userAgent).toBe(`antigravity/cli/1.0.4 ${buildAntigravityHarnessPlatformArch()}`)
    expect(fingerprint.apiClient).toBe("antigravity-cli")
    expect(fingerprint.clientMetadata).toEqual({
      ideType: "ANTIGRAVITY",
      platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
      pluginType: "GEMINI",
    })
  })

  it("migrates old randomized saved fingerprints to the agy CLI platform/arch", async () => {
    const { buildAntigravityHarnessPlatformArch, updateFingerprintVersion } = await import("./fingerprint.ts")
    const fingerprint = {
      deviceId: "device",
      sessionToken: "session",
      userAgent: "antigravity/1.18.3 win32/x64",
      apiClient: "google-cloud-sdk vscode/1.96.0",
      clientMetadata: {
        ideType: "ANTIGRAVITY",
        platform: "WINDOWS",
        pluginType: "GEMINI",
      },
      createdAt: 0,
    }

    expect(updateFingerprintVersion(fingerprint)).toBe(true)
    expect(fingerprint.userAgent).toBe(`antigravity/cli/1.0.4 ${buildAntigravityHarnessPlatformArch()}`)
  })
})
