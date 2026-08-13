import crypto from 'node:crypto'

/**
 * Google Search Tool Implementation
 *
 * Due to Gemini API limitations, native search tools (googleSearch, urlContext)
 * cannot be combined with function declarations. This module implements a
 * wrapper that makes separate API calls with only the grounding tools enabled.
 */

import {
  ANTIGRAVITY_ENDPOINT,
  SEARCH_MODEL,
  SEARCH_SYSTEM_INSTRUCTION,
  SEARCH_TIMEOUT_MS,
} from '../constants'
import { fetchWithAgyCliTransport } from './agy-transport'
import { buildFingerprintHeaders, getSessionFingerprint } from './fingerprint'
import { createLogger } from './logger'

const log = createLogger('search')

// ============================================================================
// Types
// ============================================================================

interface GroundingChunk {
  web?: {
    uri?: string
    title?: string
  }
}

interface GroundingSupport {
  segment?: {
    startIndex?: number
    endIndex?: number
    text?: string
  }
  groundingChunkIndices?: number[]
}

interface GroundingMetadata {
  webSearchQueries?: string[]
  groundingChunks?: GroundingChunk[]
  groundingSupports?: GroundingSupport[]
  searchEntryPoint?: {
    renderedContent?: string
  }
}

interface UrlMetadata {
  retrieved_url?: string
  url_retrieval_status?: string
}

interface UrlContextMetadata {
  url_metadata?: UrlMetadata[]
}

interface SearchResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
      role?: string
    }
    finishReason?: string
    groundingMetadata?: GroundingMetadata
    urlContextMetadata?: UrlContextMetadata
  }>
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

interface AntigravitySearchResponse {
  response?: SearchResponse
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

export interface SearchArgs {
  query: string
  urls?: string[]
  thinking?: boolean
}

export interface SearchResult {
  text: string
  sources: Array<{ title: string; url: string }>
  searchQueries: string[]
  urlsRetrieved: Array<{ url: string; status: string }>
  /** Raw per-claim citation supports, used for inline marker insertion. */
  supports: GroundingSupport[]
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateRequestId(): string {
  return `agent/${crypto.randomUUID()}/${Date.now()}/${crypto.randomUUID()}/2`
}

// ============================================================================
// Citation Markers + URL Resolution
// ============================================================================

/**
 * Converts a character offset into a UTF-8 byte offset.
 * Grounding segment indices are character-based; splicing must be byte-based.
 */
function charIndexToByteIndex(text: string, charIndex: number): number {
  return new TextEncoder().encode(text.slice(0, charIndex)).length
}

/**
 * Insert inline citation markers ([n]) into the model's raw text based on
 * groundingSupports segment offsets. Total function: any anomaly degrades to
 * the unmodified text — citation logic can never corrupt the answer.
 *
 * Guards:
 * - Missing/invalid segment or indices -> skipped
 * - Out-of-bounds or inverted ranges -> skipped
 * - Text already containing [n] self-citations -> skipped entirely
 * - Insertions applied descending by offset so earlier ones don't shift later ones
 */
export function insertCitationMarkers(
  text: string,
  supports: GroundingSupport[],
): string {
  if (!text || !supports?.length) {
    return text
  }
  // The model already cited (e.g. per system instruction) — avoid double markers.
  if (/\[\d+\]/.test(text)) {
    return text
  }

  const insertions: Array<{ byteIndex: number; marker: string }> = []
  for (const support of supports) {
    const segment = support.segment
    const indices = support.groundingChunkIndices
    if (!segment || !indices?.length) continue
    if (segment.startIndex == null || segment.endIndex == null) continue
    if (segment.startIndex < 0 || segment.endIndex <= 0) continue
    if (segment.startIndex > segment.endIndex || segment.endIndex > text.length)
      continue
    insertions.push({
      byteIndex: charIndexToByteIndex(text, segment.endIndex),
      marker: indices.map((i) => `[${i + 1}]`).join(''),
    })
  }
  if (!insertions.length) {
    return text
  }

  // Descending order: earlier offsets stay valid as we splice from the end.
  insertions.sort((a, b) => b.byteIndex - a.byteIndex)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let bytes = encoder.encode(text)
  for (const insertion of insertions) {
    const before = bytes.slice(0, insertion.byteIndex)
    const after = bytes.slice(insertion.byteIndex)
    const markerBytes = encoder.encode(insertion.marker)
    const next = new Uint8Array(
      before.length + markerBytes.length + after.length,
    )
    next.set(before)
    next.set(markerBytes, before.length)
    next.set(after, before.length + markerBytes.length)
    bytes = next
  }
  return decoder.decode(bytes)
}

const REDIRECT_RESOLVE_TIMEOUT_MS = 2000

/**
 * Resolve a grounding redirect URI (vertexaisearch.cloud.google.com/...)
 * to its canonical URL. Only redirect URIs are fetched; everything else
 * passes through untouched. Failures fall back to the original URI.
 */
export async function resolveSourceUrl(uri: string): Promise<string> {
  if (!uri.includes('grounding-api-redirect')) {
    return uri
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      REDIRECT_RESOLVE_TIMEOUT_MS,
    )
    try {
      const response = await fetch(uri, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      })
      return response.url || uri
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return uri
  }
}

/**
 * Resolve all source URIs in parallel, preserving order.
 */
async function resolveSourceUrls(
  sources: Array<{ title: string; url: string }>,
): Promise<Array<{ title: string; url: string }>> {
  return Promise.all(
    sources.map(async (source) => ({
      ...source,
      url: await resolveSourceUrl(source.url),
    })),
  )
}

function formatSearchResult(result: SearchResult): string {
  const lines: string[] = []

  lines.push('## Search Results\n')
  lines.push(insertCitationMarkers(result.text, result.supports))
  lines.push('')

  if (result.sources.length > 0) {
    lines.push('### Sources')
    for (const source of result.sources) {
      lines.push(`- [${source.title}](${source.url})`)
    }
    lines.push('')
  }

  if (result.urlsRetrieved.length > 0) {
    lines.push('### URLs Retrieved')
    for (const url of result.urlsRetrieved) {
      const status = url.status === 'URL_RETRIEVAL_STATUS_SUCCESS' ? '✓' : '✗'
      lines.push(`- ${status} ${url.url}`)
    }
    lines.push('')
  }

  if (result.searchQueries.length > 0) {
    lines.push('### Search Queries Used')
    for (const q of result.searchQueries) {
      lines.push(`- "${q}"`)
    }
  }

  return lines.join('\n')
}

function parseSearchResponse(
  data: AntigravitySearchResponse,
): Promise<SearchResult> {
  const result: SearchResult = {
    text: '',
    sources: [],
    searchQueries: [],
    urlsRetrieved: [],
    supports: [],
  }

  const response = data.response
  if (!response || !response.candidates || response.candidates.length === 0) {
    if (data.error) {
      result.text = `Error: ${data.error.message ?? 'Unknown error'}`
    } else if (response?.error) {
      result.text = `Error: ${response.error.message ?? 'Unknown error'}`
    }
    return Promise.resolve(result)
  }

  const candidate = response.candidates[0]
  if (!candidate) {
    return Promise.resolve(result)
  }

  // Extract text content
  if (candidate.content?.parts) {
    result.text = candidate.content.parts
      .map((p: { text?: string }) => p.text ?? '')
      .filter(Boolean)
      .join('\n')
  }

  // Extract grounding metadata
  if (candidate.groundingMetadata) {
    const groundingMeta = candidate.groundingMetadata

    if (groundingMeta.webSearchQueries) {
      result.searchQueries = groundingMeta.webSearchQueries
    }

    if (groundingMeta.groundingChunks) {
      for (const chunk of groundingMeta.groundingChunks) {
        if (chunk.web?.uri && chunk.web?.title) {
          result.sources.push({
            title: chunk.web.title,
            url: chunk.web.uri,
          })
        }
      }
    }

    result.supports = groundingMeta.groundingSupports ?? []
  }

  // Extract URL context metadata
  if (candidate.urlContextMetadata?.url_metadata) {
    for (const meta of candidate.urlContextMetadata.url_metadata) {
      if (meta.retrieved_url) {
        result.urlsRetrieved.push({
          url: meta.retrieved_url,
          status: meta.url_retrieval_status ?? 'UNKNOWN',
        })
      }
    }
  }

  // Resolve grounding redirect URIs to canonical URLs (parallel, order-preserving).
  return resolveSourceUrls(result.sources).then((resolved) => {
    result.sources = resolved
    return result
  })
}

// ============================================================================
// Main Search Function
// ============================================================================

/**
 * Execute a Google Search using the Gemini grounding API.
 *
 * This makes a SEPARATE API call with only googleSearch/urlContext tools,
 * which is required because these tools cannot be combined with function declarations.
 */
export async function executeSearch(
  args: SearchArgs,
  accessToken: string,
  projectId: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const { query, urls, thinking = true } = args

  // Build prompt with optional URLs
  let prompt = query
  if (urls && urls.length > 0) {
    const urlList = urls.join('\n')
    prompt = `${query}\n\nURLs to analyze:\n${urlList}`
  }

  // Build tools array - only grounding tools, no function declarations
  const tools: Array<Record<string, unknown>> = []
  tools.push({
    googleSearch: {
      enhancedContent: {
        imageSearch: {
          maxResultCount: 5,
        },
      },
    },
  })
  if (urls && urls.length > 0) {
    tools.push({ urlContext: {} })
  }

  // Wrap in Antigravity format using the captured agy CLI envelope ordering.
  const wrappedBody = {
    project: projectId,
    requestId: generateRequestId(),
    request: {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      systemInstruction: {
        role: 'user',
        parts: [{ text: SEARCH_SYSTEM_INSTRUCTION }],
      },
      tools,
      generationConfig: {
        candidateCount: 1,
      },
    },
    model: SEARCH_MODEL,
    userAgent: 'antigravity',
    requestType: 'agent',
  }

  // Use non-streaming endpoint for search
  const url = `${ANTIGRAVITY_ENDPOINT}/v1internal:generateContent`

  log.debug('Executing search', {
    query,
    urlCount: urls?.length ?? 0,
    thinking,
  })

  try {
    const fingerprintHeaders = buildFingerprintHeaders(getSessionFingerprint())
    const response = await fetchWithAgyCliTransport(
      url,
      {
        method: 'POST',
        headers: {
          'User-Agent':
            fingerprintHeaders['User-Agent'] ??
            getSessionFingerprint().userAgent,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept-Encoding': 'identity',
        },
        body: JSON.stringify(wrappedBody),
      },
      { signal: abortSignal ?? AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
    )

    if (!response.ok) {
      const errorText = await response.text()
      log.debug('Search API error', {
        status: response.status,
        error: errorText,
      })
      return `## Search Error\n\nFailed to execute search: ${response.status} ${response.statusText}\n\n${errorText}\n\nPlease try again with a different query.`
    }

    const data = (await response.json()) as AntigravitySearchResponse
    log.debug('Search response received', { hasResponse: !!data.response })

    const result = await parseSearchResponse(data)
    const formatted = formatSearchResult(result)
    log.debug('Search response formatted', { resultLength: formatted.length })
    return formatted
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.debug('Search execution error', { error: message })
    return `## Search Error\n\nFailed to execute search: ${message}. Please try again with a different query.`
  }
}
