import { describe, expect, it } from "vitest"

import { parseGeminiSse } from "./stream.ts"

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

describe("parseGeminiSse", () => {
  it("parses complete SSE frames into chunks", async () => {
    const response = sseResponse([
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"hi"}]}}]}\n\n',
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"candidatesTokenCount":3}}\n\n',
    ])

    const chunks = []
    for await (const chunk of parseGeminiSse(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.candidates?.[0]?.content?.parts?.[0]).toEqual({ text: "hi" })
    expect(chunks[1]?.candidates?.[0]?.finishReason).toBe("STOP")
    expect(chunks[1]?.usageMetadata?.candidatesTokenCount).toBe(3)
  })

  it("handles frames split across read boundaries", async () => {
    const response = sseResponse([
      'data: {"candidates":[{"content":{"rol',
      'e":"model","parts":[{"text":"split"}]}}]}\n\n',
    ])

    const chunks = []
    for await (const chunk of parseGeminiSse(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.candidates?.[0]?.content?.parts?.[0]).toEqual({ text: "split" })
  })

  it("ignores [DONE] sentinels and malformed frames", async () => {
    const response = sseResponse([
      "data: [DONE]\n\n",
      "data: not-json\n\n",
      'data: {"candidates":[{"finishReason":"STOP"}]}\n\n',
    ])

    const chunks = []
    for await (const chunk of parseGeminiSse(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.candidates?.[0]?.finishReason).toBe("STOP")
  })

  it("returns nothing for an empty body", async () => {
    const response = new Response(null, { status: 200 })
    const chunks = []
    for await (const chunk of parseGeminiSse(response)) {
      chunks.push(chunk)
    }
    expect(chunks).toHaveLength(0)
  })
})
