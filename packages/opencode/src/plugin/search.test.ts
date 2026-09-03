import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'

mock.module('./agy-transport', () => ({
  fetchWithAgyCliTransport: mock(),
}))

import {
  executeSearch,
  insertCitationMarkers,
  resolveSourceUrl,
} from './search'

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
  const { fetchWithAgyCliTransport } = await import('./agy-transport')
  const spy = mockFetch(body, status)
  ;(fetchWithAgyCliTransport as any).mockImplementation(spy)
  return spy
}

// ─── executeSearch ────────────────────────────────────────────────────────────

describe('executeSearch', () => {
  let fetchWithAgyCliTransport: any

  beforeEach(async () => {
    ;({ fetchWithAgyCliTransport } = await import('./agy-transport'))
    fetchWithAgyCliTransport.mockReset()
    mockAgyTransport(makeResponse('Default result'))
  })

  afterEach(() => {
    mock.restore()
  })

  it('returns formatted text from the response', async () => {
    await mockAgyTransport(makeResponse('The answer is 42.'))
    const result = await executeSearch({ query: 'what is 42?' }, 'tok', 'proj')
    expect(result).toContain('The answer is 42.')
    expect(result).toContain('## Search Results')
  })

  it('lists sources from groundingChunks (uses groundingMeta internally)', async () => {
    await mockAgyTransport(
      makeResponse('answer', {
        chunks: [{ title: 'Example', uri: 'https://example.com/page' }],
      }),
    )
    const result = await executeSearch({ query: 'q' }, 'tok', 'proj')
    expect(result).toContain('### Sources')
    expect(result).toContain('Example')
    expect(result).toContain('https://example.com/page')
  })

  it('includes search queries section when queries are present', async () => {
    await mockAgyTransport(makeResponse('res', { searchQueries: ['my query'] }))
    const result = await executeSearch({ query: 'my query' }, 'tok', 'proj')
    expect(result).toContain('### Search Queries Used')
    expect(result).toContain('"my query"')
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
    const result = await executeSearch(
      { query: 'q', urls: ['https://docs.example.com'] },
      'tok',
      'proj',
    )
    expect(result).toContain('✓')
    expect(result).toContain('https://docs.example.com')
  })

  it('marks failed URL retrieval with ✗', async () => {
    await mockAgyTransport(
      makeResponse('ok', {
        urlMetadata: [
          {
            retrieved_url: 'https://broken.example.com',
            url_retrieval_status: 'URL_RETRIEVAL_STATUS_ERROR',
          },
        ],
      }),
    )
    const result = await executeSearch(
      { query: 'q', urls: ['https://broken.example.com'] },
      'tok',
      'proj',
    )
    expect(result).toContain('✗')
  })

  it('returns error block on non-OK HTTP response', async () => {
    await mockAgyTransport({ error: 'bad' }, 400)
    const result = await executeSearch({ query: 'q' }, 'tok', 'proj')
    expect(result).toContain('## Search Error')
    expect(result).toContain('400')
  })

  it('returns error block when fetch throws', async () => {
    fetchWithAgyCliTransport.mockRejectedValue(new Error('Network down'))
    const result = await executeSearch({ query: 'q' }, 'tok', 'proj')
    expect(result).toContain('## Search Error')
    expect(result).toContain('Network down')
  })

  it('uses captured agy CLI content headers and envelope ordering', async () => {
    const spy = await mockAgyTransport(makeResponse('ok'))
    await executeSearch({ query: 'q' }, 'bearer-token-xyz', 'proj')
    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const body = JSON.parse(init.body as string)

    expect(headers.Authorization).toBe('Bearer bearer-token-xyz')
    expect(headers['User-Agent']).toMatch(
      /^antigravity\/cli\/1\.1\.24 \(aidev_client; os_type=.+; arch=.+; cl=974782877; auth_method=consumer\)$/,
    )
    expect(headers['X-Goog-Api-Client']).toBeUndefined()
    expect(headers['Client-Metadata']).toBeUndefined()
    expect(Object.keys(body)).toEqual([
      'project',
      'requestId',
      'request',
      'model',
      'userAgent',
      'requestType',
    ])
    expect(body.requestId).toMatch(/^agent\/.+\/2$/)
    expect(body.userAgent).toBe('antigravity')
    expect(body.requestType).toBe('agent')
  })

  it('renders inline citation markers from groundingSupports', async () => {
    await mockAgyTransport(
      makeResponse('Tokyo is hot and humid.', {
        chunks: [{ title: 'aqi.in', uri: 'https://www.aqi.in/weather' }],
        supports: [{ startIndex: 0, endIndex: 23, indices: [0] }],
      }),
    )
    const result = await executeSearch(
      { query: 'tokyo weather' },
      'tok',
      'proj',
    )
    expect(result).toContain('Tokyo is hot and humid.[1]')
    expect(result).toContain('### Sources')
  })

  it('does not double-cite when the model already emitted markers', async () => {
    await mockAgyTransport(
      makeResponse('Tokyo is hot [1].', {
        chunks: [{ title: 'aqi.in', uri: 'https://www.aqi.in/weather' }],
        supports: [{ startIndex: 0, endIndex: 14, indices: [0] }],
      }),
    )
    const result = await executeSearch(
      { query: 'tokyo weather' },
      'tok',
      'proj',
    )
    expect(result).toContain('Tokyo is hot [1].')
    expect(result).not.toContain('[1][1]')
  })

  it('resolves grounding redirect URIs to canonical URLs in Sources', async () => {
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123'
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
      url: 'https://www.real-site.example/article',
      ok: true,
    } as Response)
    await mockAgyTransport(
      makeResponse('answer', {
        chunks: [{ title: 'Real Site', uri: redirect }],
      }),
    )
    const result = await executeSearch({ query: 'q' }, 'tok', 'proj')
    expect(fetchSpy).toHaveBeenCalledWith(
      redirect,
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(result).toContain('https://www.real-site.example/article')
    expect(result).not.toContain(redirect)
  })
})

// ─── insertCitationMarkers ────────────────────────────────────────────────────

describe('insertCitationMarkers', () => {
  it('inserts a marker at the segment end offset', () => {
    expect(
      insertCitationMarkers('Tokyo is hot.', [
        {
          segment: { startIndex: 0, endIndex: 13 },
          groundingChunkIndices: [0],
        },
      ]),
    ).toBe('Tokyo is hot.[1]')
  })

  it('maps multiple chunk indices to combined markers', () => {
    expect(
      insertCitationMarkers('Tokyo is hot.', [
        {
          segment: { startIndex: 0, endIndex: 13 },
          groundingChunkIndices: [0, 2],
        },
      ]),
    ).toBe('Tokyo is hot.[1][3]')
  })

  it('applies multiple supports without offset drift', () => {
    const text = 'First claim. Second claim.'
    const supports = [
      { segment: { startIndex: 0, endIndex: 12 }, groundingChunkIndices: [0] },
      { segment: { startIndex: 13, endIndex: 26 }, groundingChunkIndices: [1] },
    ]
    expect(insertCitationMarkers(text, supports)).toBe(
      'First claim.[1] Second claim.[2]',
    )
  })

  it('preserves multibyte characters (character vs byte offsets)', () => {
    const text = '日本語のテキストです。'
    expect(
      insertCitationMarkers(text, [
        { segment: { startIndex: 0, endIndex: 6 }, groundingChunkIndices: [0] },
      ]),
    ).toBe('日本語のテキ[1]ストです。')
  })

  it('skips insertion when the text already contains self-citations', () => {
    const text = 'See [1] for details.'
    expect(
      insertCitationMarkers(text, [
        { segment: { startIndex: 0, endIndex: 7 }, groundingChunkIndices: [0] },
      ]),
    ).toBe(text)
  })

  it('degrades gracefully on out-of-bounds segments', () => {
    const text = 'Short text.'
    const supports = [
      { segment: { startIndex: 0, endIndex: 99 }, groundingChunkIndices: [0] }, // beyond end
      { segment: { startIndex: 5, endIndex: 2 }, groundingChunkIndices: [0] }, // inverted
      { segment: { startIndex: -1, endIndex: 3 }, groundingChunkIndices: [0] }, // negative
    ]
    expect(insertCitationMarkers(text, supports)).toBe(text)
  })

  it('returns the text unchanged when supports are empty', () => {
    expect(insertCitationMarkers('Plain text.', [])).toBe('Plain text.')
  })
})

// ─── resolveSourceUrl ─────────────────────────────────────────────────────────

describe('resolveSourceUrl', () => {
  afterEach(() => {
    mock.restore()
  })

  it('passes non-redirect URIs through without fetching', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    await expect(resolveSourceUrl('https://example.com/page')).resolves.toBe(
      'https://example.com/page',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves redirect URIs to the canonical URL', async () => {
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz'
    spyOn(globalThis, 'fetch').mockResolvedValue({
      url: 'https://canonical.example/a',
      ok: true,
    } as Response)
    await expect(resolveSourceUrl(redirect)).resolves.toBe(
      'https://canonical.example/a',
    )
  })

  it('falls back to the original URI when resolution fails', async () => {
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz'
    spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    await expect(resolveSourceUrl(redirect)).resolves.toBe(redirect)
  })
})
