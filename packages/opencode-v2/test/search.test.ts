import { afterEach, describe, expect, it, mock } from 'bun:test'

import * as core from '@cortexkit/antigravity-auth-core'

const fetchSpy = mock()

mock.module('@cortexkit/antigravity-auth-core', () => ({
  ...core,
  fetchWithAgyCliTransport: fetchSpy,
}))

import {
  executeSearch,
  formatSearchOutput,
  insertCitationMarkers,
  resolveSourceUrl,
  SearchHttpError,
} from '../src/search'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(
  text: string,
  opts: {
    searchQueries?: string[]
    chunks?: Array<{ title: string; uri: string }>
    urlMetadata?: Array<{ retrieved_url: string; url_retrieval_status: string }>
    supports?: Array<{
      startIndex: number
      endIndex: number
      indices: number[]
    }>
  } = {},
) {
  return {
    response: {
      candidates: [
        {
          content: { role: 'model', parts: [{ text }] },
          finishReason: 'STOP',
          groundingMetadata: {
            webSearchQueries: opts.searchQueries ?? [],
            groundingChunks: (opts.chunks ?? []).map((c) => ({ web: c })),
            groundingSupports: (opts.supports ?? []).map((s) => ({
              segment: { startIndex: s.startIndex, endIndex: s.endIndex },
              groundingChunkIndices: s.indices,
            })),
          },
          urlContextMetadata: { url_metadata: opts.urlMetadata ?? [] },
        },
      ],
    },
  }
}

function mockFetch(body: unknown, status = 200) {
  return mock().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

async function mockAgyTransport(body: unknown, status = 200) {
  const spy = mockFetch(body, status)
  fetchSpy.mockImplementation(spy)
  return spy
}

// ─── executeSearch ────────────────────────────────────────────────────────────

describe('executeSearch', () => {
  afterEach(() => {
    mock.restore()
  })

  it('returns a result whose formatted output contains the answer', async () => {
    await mockAgyTransport(makeResponse('The answer is 42.'))
    const result = await executeSearch({ query: 'what is 42?' }, 'tok', 'proj')
    const output = formatSearchOutput(result)
    expect(output).toContain('The answer is 42.')
    expect(output).toContain('## Search Results')
  })

  it('lists sources from groundingChunks', async () => {
    await mockAgyTransport(
      makeResponse('answer', {
        chunks: [{ title: 'Example', uri: 'https://example.com/page' }],
      }),
    )
    const result = await executeSearch({ query: 'q' }, 'tok', 'proj')
    const output = formatSearchOutput(result)
    expect(output).toContain('### Sources')
    expect(output).toContain('Example')
    expect(output).toContain('https://example.com/page')
  })

  it('includes search queries section when queries are present', async () => {
    await mockAgyTransport(makeResponse('res', { searchQueries: ['my query'] }))
    const result = await executeSearch({ query: 'my query' }, 'tok', 'proj')
    const output = formatSearchOutput(result)
    expect(output).toContain('### Search Queries Used')
    expect(output).toContain('"my query"')
  })

  it('marks successful URL retrieval with ✓', async () => {
    await mockAgyTransport(
      makeResponse('ok', {
        urlMetadata: [
          {
            retrieved_url: 'https://docs.example.com',
            url_retrieval_status: 'URL_RETRIEVAL_STATUS_SUCCESS',
          },
        ],
      }),
    )
    const result = await executeSearch({ query: 'q' }, 'tok', 'proj')
    const output = formatSearchOutput(result)
    expect(output).toContain('✓ https://docs.example.com')
  })

  it('marks failed URL retrieval with ✗', async () => {
    await mockAgyTransport(
      makeResponse('ok', {
        urlMetadata: [
          {
            retrieved_url: 'https://broken.example.com',
            url_retrieval_status: 'URL_RETRIEVAL_STATUS_FAILED',
          },
        ],
      }),
    )
    const result = await executeSearch({ query: 'q' }, 'tok', 'proj')
    const output = formatSearchOutput(result)
    expect(output).toContain('✗ https://broken.example.com')
  })

  it('always sends thinking enabled with the deep budget', async () => {
    const spy = await mockAgyTransport(makeResponse('res'))
    await executeSearch({ query: 'q' }, 'tok', 'proj')
    expect(spy).toHaveBeenCalledTimes(1)
    const [, init] = spy.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(init.body) as {
      request: {
        generationConfig: { thinkingConfig: { thinkingBudget: number } }
      }
    }
    expect(body.request.generationConfig.thinkingConfig.thinkingBudget).toBe(
      core.SEARCH_THINKING_BUDGET_DEEP,
    )
  })

  it('adds urlContext tool and appends URLs to the prompt when urls are given', async () => {
    const spy = await mockAgyTransport(makeResponse('res'))
    await executeSearch(
      { query: 'summarize', urls: ['https://example.com/a'] },
      'tok',
      'proj',
    )
    const [, init] = spy.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(init.body) as {
      request: {
        contents: Array<{ parts: Array<{ text: string }> }>
        tools: Array<Record<string, unknown>>
      }
    }
    expect(body.request.tools).toHaveLength(2)
    expect(body.request.tools[1]).toHaveProperty('urlContext')
    expect(body.request.contents[0]?.parts[0]?.text).toContain(
      'https://example.com/a',
    )
  })

  it('sends bearer auth and the search model', async () => {
    const spy = await mockAgyTransport(makeResponse('res'))
    await executeSearch({ query: 'q' }, 'tok', 'proj-1')
    const [url, init] = spy.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ]
    expect(url).toContain('v1internal:generateContent')
    expect(init.headers.Authorization).toBe('Bearer tok')
    const body = JSON.parse((spy.mock.calls[0] as any)[1].body) as {
      project: string
      model: string
    }
    expect(body.project).toBe('proj-1')
    expect(body.model).toBe(core.SEARCH_MODEL)
  })

  it('throws SearchHttpError on non-2xx responses', async () => {
    await mockAgyTransport({ error: { message: 'quota exceeded' } }, 429)
    try {
      await executeSearch({ query: 'q' }, 'tok', 'proj')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SearchHttpError)
      expect((error as SearchHttpError).status).toBe(429)
    }
  })

  it('returns error text when the response carries an API error payload', async () => {
    await mockAgyTransport({
      error: { code: 500, message: 'boom', status: 'INTERNAL' },
    })
    const result = await executeSearch({ query: 'q' }, 'tok', 'proj')
    expect(result.text).toContain('Error: boom')
  })
})

// ─── insertCitationMarkers ────────────────────────────────────────────────────

describe('insertCitationMarkers', () => {
  it('inserts [n] markers at segment ends', () => {
    const supports = [
      { segment: { startIndex: 0, endIndex: 5 }, groundingChunkIndices: [0] },
    ]
    expect(insertCitationMarkers('hello world', supports)).toBe(
      'hello[1] world',
    )
  })

  it('combines multiple chunk indices into one marker', () => {
    const supports = [
      {
        segment: { startIndex: 0, endIndex: 5 },
        groundingChunkIndices: [0, 2],
      },
    ]
    expect(insertCitationMarkers('hello world', supports)).toBe(
      'hello[1][3] world',
    )
  })

  it('skips when text already contains self-citations', () => {
    const supports = [
      { segment: { startIndex: 0, endIndex: 5 }, groundingChunkIndices: [0] },
    ]
    expect(insertCitationMarkers('hello [1] world', supports)).toBe(
      'hello [1] world',
    )
  })

  it('skips invalid or out-of-bounds segments', () => {
    const text = 'hello world'
    const supports = [
      { segment: { startIndex: 0, endIndex: 99 }, groundingChunkIndices: [0] },
      { segment: { startIndex: 9, endIndex: 3 }, groundingChunkIndices: [0] },
      { segment: undefined, groundingChunkIndices: [0] },
      { segment: { startIndex: 0, endIndex: 5 }, groundingChunkIndices: [] },
    ]
    expect(insertCitationMarkers(text, supports)).toBe(text)
  })

  it('preserves multibyte characters (character vs byte offsets)', () => {
    // 'héllo wörld 🎉' — é is 2 bytes, 🎉 is 4 bytes in UTF-8. Segment ending
    // after char index 6 ('héllo ') must splice at the BYTE offset (7),
    // which lands between the space and 'wörld'.
    const text = 'héllo wörld 🎉'
    const supports = [
      { segment: { startIndex: 0, endIndex: 6 }, groundingChunkIndices: [0] },
    ]
    const result = insertCitationMarkers(text, supports)
    expect(result).toBe('héllo [1]wörld 🎉')
    // Decoded text must not contain replacement characters.
    expect(result.includes('\uFFFD')).toBe(false)
  })
})

// ─── resolveSourceUrl ─────────────────────────────────────────────────────────

describe('resolveSourceUrl', () => {
  afterEach(() => {
    mock.restore()
  })

  it('passes non-redirect URIs through untouched', async () => {
    const uri = 'https://example.com/page'
    expect(await resolveSourceUrl(uri)).toBe(uri)
  })

  it('follows grounding redirects to the canonical URL', async () => {
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc'
    const fetchMock = mock().mockResolvedValue({
      url: 'https://example.com/final',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      expect(await resolveSourceUrl(redirect)).toBe('https://example.com/final')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('falls back to the original URI when the redirect fetch fails', async () => {
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock().mockRejectedValue(
      new Error('down'),
    ) as unknown as typeof fetch
    try {
      expect(await resolveSourceUrl(redirect)).toBe(redirect)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
