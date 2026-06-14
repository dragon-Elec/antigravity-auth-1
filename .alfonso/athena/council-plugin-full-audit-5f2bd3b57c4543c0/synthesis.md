---
council: council-plugin-full-audit-5f2bd3b57c4543c0
question: Let's run a full audit for this plugin
date: 2026-06-13
members: [XAI Composer 2.5, GPT 5.5 Creative, Ollama Kimi 2.7, GPT 5.4 high, GPT 5.5 xhigh, Ollama Minimax M3]
session_ids: [bg_ae8aacb8, bg_cea2d782, bg_5e197b7c, bg_a1d6148c, bg_8792d94f, bg_c2c39796]
mode: Solo
intent: AUDIT
responded: 6/8
---

# Full Audit — CortexKit Antigravity Auth Monorepo

6 of 8 council members completed (2 Gemini members failed: their model IDs do not resolve in the router). 87 raw findings were reported; consolidated below into 14 cross-corroborated findings plus 16 notable solo findings.

Confidence buckets (6 members): **Unanimous** 5–6 · **Majority** 4 · **Minority** 2–3 · **Solo** 1.

---

## Majority findings (4+ members)

#### #1: Raw AGY socket transport has multiple lifecycle defects
- **Severity**: High
- **Confidence**: Majority (5 members)
- **Members Reported**: [XAI Composer 2.5, Ollama Kimi 2.7, GPT 5.4 high, GPT 5.5 xhigh, Ollama Minimax M3]
- **Issue**: `fetchWithAgyCliTransport` / `buildResponseStream` in `packages/core/src/agy-transport.ts` have overlapping correctness gaps: (a) only the response **header** is timeout-bounded — no body/idle-read timeout, so a hung SSE body holds the socket; (b) the abort listener is attached **after** TLS/proxy connect completes, so a cancelled request hangs until the connect/header timeout; (c) `Content-Length` is never parsed — non-chunked responses are read until socket end, which is not a valid HTTP/1.1 boundary on keep-alive; (d) several error paths (proxy CONNECT/TLS handshake failure, sync throw in the decode pipe) leak sockets / can emit unhandled `error` events.
- **Evidence**: `agy-transport.ts:67,84-85,143-237,263-301,351-423`; `DEFAULT_AGY_RESPONSE_HEADER_TIMEOUT_MS`; `parseResponseHead()` records only `chunked`/`gzip`.
- **Impact**: Socket leaks, hung requests on slow/aborted streams, possible truncated/over-read bodies on keep-alive connections.
- **Fix Direction**: Add body/idle-read timeout; pass `AbortSignal` into connect/handshake and race against abort; parse `Content-Length` and bound the reader (or force `Connection: close`); always destroy proxy socket on any failure; add a no-op `error` listener before async ops.

#### #2: OAuth callback `state` / PKCE verifier is not validated against the initiating login
- **Severity**: High
- **Confidence**: Majority (4 members)
- **Members Reported**: [GPT 5.5 Creative, GPT 5.4 high, GPT 5.5 xhigh, Ollama Minimax M3]
- **Issue**: The PKCE verifier is base64url-encoded into the OAuth `state` and decoded at token exchange. The callback handler trusts whatever `state` arrives and uses it as the verifier source — `state` is a transport container, not a CSRF/session-binding token. No equality check against the originally issued state. Aggravated by the listener binding `0.0.0.0` for WSL/SSH.
- **Evidence**: `packages/core/src/antigravity/oauth.ts:118-156,224-247` (`encodeState`/`decodeState`); `packages/opencode/src/plugin.ts:722-769` (`parseOAuthCallbackInput`); `packages/pi/src/index.ts:34-47`; `server.ts:115-134` (bind address).
- **Impact**: Login-CSRF / account-injection — a different flow's `code`+`state` pair can be exchanged; on a shared network an attacker racing the loopback port can complete an exchange.
- **Fix Direction**: Persist the originally generated state/verifier locally keyed by a random nonce; require exact state match before exchange; refuse exchange on bare-code paste without matching state; bind to `127.0.0.1` only.

#### #3: Account persistence merge silently loses deletions and state updates
- **Severity**: High
- **Confidence**: Majority (4 members)
- **Members Reported**: [XAI Composer 2.5, Ollama Kimi 2.7, GPT 5.4 high, GPT 5.5 xhigh]
- **Issue**: `saveAccounts()` re-reads the file inside the lock and does `mergeAccountStorage(existing, storage)`. This means: (a) revoked/deleted accounts (`removeAccount` on `invalid_grant`) get merged back from disk instead of staying deleted — `saveAccountsReplace()` exists for this but isn't used; (b) "start fresh" login still merges old accounts; (c) on `ELOCKED`, the debounced `executeSave` resolves waiters as success without retry, so rate-limit flags / refreshed tokens may never reach disk; (d) `clearAccounts()` unlinks without a lock while debounced saves can write state back.
- **Evidence**: `packages/opencode/src/plugin/storage.ts:767-788` (merge), `825-834` (clear); `packages/opencode/src/plugin/accounts.ts` (`executeSave` ELOCKED branch, `requestSaveToDisk`); `packages/opencode/src/plugin.ts:1893-1900,786-791`.
- **Impact**: Deleted/revoked accounts resurrect; lost rate-limit and token state across concurrent processes; data loss on lock contention.
- **Fix Direction**: Use replace semantics when the pool shrinks; teach merge to honor explicit deletions; retry/queue saves on `ELOCKED` instead of resolving as success; lock + flush pending saves around destructive ops.

---

## Minority findings (2–3 members)

#### #4: Hardcoded OAuth client_secret committed and published
- **Severity**: Critical
- **Confidence**: Minority (3 members)
- **Members Reported**: [XAI Composer 2.5, Ollama Kimi 2.7, Ollama Minimax M3]
- **Issue**: A real Google OAuth `client_secret` is hard-coded in `packages/core/src/constants.ts` and shipped in three publishable npm packages. Anyone with the tarball can mint refresh tokens for the official Antigravity OAuth app or hit Google quotas under the victim project. It is a long-lived secret in git history that can't be revoked without rotating the public client.
- **Evidence**: `packages/core/src/constants.ts:4-9` (`ANTIGRAVITY_CLIENT_SECRET = "GOCSPX-..."`), consumed at `oauth.ts:75,80,242,247` and `packages/opencode/src/plugin/token.ts:106`; re-exported via core `index.ts`.
- **Impact**: Credential leak / token harvesting / quota abuse; possible Google ToS violation.
- **Fix Direction**: Treat as a public PKCE client with no secret if Google permits; otherwise inject the secret at install/runtime via env or user config and rotate now. (Note: only 3/6 flagged it, but the 3 that did rate it Critical with direct source evidence — recommended cross-check candidate.)

#### #5: Pi package sends unsanitized tool schemas with the wrong field name
- **Severity**: High
- **Confidence**: Minority (3 members)
- **Members Reported**: [XAI Composer 2.5, GPT 5.5 Creative, GPT 5.5 xhigh]
- **Issue**: `packages/pi/src/convert.ts` emits `functionDeclarations[].parametersJsonSchema = tool.parameters` raw, bypassing the core Gemini schema sanitizer that OpenCode uses. Unsupported keywords (`$ref`, `const`, `additionalProperties`, `oneOf`…) reach the wire and the field name differs from the sanitized `parameters` used elsewhere.
- **Evidence**: `packages/pi/src/convert.ts:24-29,131-141`; `stream.ts:176-207`.
- **Impact**: Tool-bearing Pi requests rejected with `INVALID_ARGUMENT` / validation failures.
- **Fix Direction**: Reuse core `applyGeminiTransforms`/schema sanitization in Pi; emit `parameters`, not `parametersJsonSchema`.

#### #6: Debug/dump features persist sensitive prompts without strong protections
- **Severity**: High
- **Confidence**: Minority (3 members)
- **Members Reported**: [XAI Composer 2.5, GPT 5.5 Creative, GPT 5.5 xhigh]
- **Issue**: `/gemini-dump` writes full request bodies and raw responses (prompts, tool outputs, generated content) to `os.tmpdir()` by default; only header metadata is redacted. Debug mode logs up to 12k-char body previews. Files/dirs are not created with `0600`/`0700`.
- **Evidence**: `packages/opencode/src/plugin/gemini-dump.ts:14,217,247-281`; `packages/opencode/src/plugin/debug.ts:241-244,281-284,407-410`.
- **Impact**: Local data exposure of prompts/PII if left enabled or on shared temp storage.
- **Fix Direction**: Default off in production builds; `0700` dirs / `0600` files; redact `contents`/`systemInstruction`; auto-disable after N dumps; explicit confirmation.

#### #7: Refresh tokens stored in plaintext on disk
- **Severity**: High
- **Confidence**: Minority (2 members)
- **Members Reported**: [XAI Composer 2.5, Ollama Kimi 2.7]
- **Issue**: Full refresh tokens persist in `antigravity-accounts.json` as plaintext. `0o600` + `.gitignore` help but don't protect backups, sync tools, CI artifacts, or malware.
- **Evidence**: `packages/opencode/src/plugin/storage.ts` (`saveAccounts` writes `JSON.stringify`; `AccountMetadataV3.refreshToken: string`).
- **Impact**: Credential leak via any out-of-band file read.
- **Fix Direction**: OS keychain/credential store, or encrypt at rest with a machine-local key.

#### #8: Synthetic random project ID is generated per request
- **Severity**: High
- **Confidence**: Minority (2 members)
- **Members Reported**: [Ollama Kimi 2.7, Ollama Minimax M3]
- **Issue**: When `projectId` is empty and headerStyle is `antigravity`, the code calls `generateSyntheticProjectId()` (`crypto.randomUUID()` + adjective/noun) inline per request, so every request uses a different `project` value and the value is never persisted — defeating prompt cache and fragmenting server-side session/quota state. The documented `ANTIGRAVITY_DEFAULT_PROJECT_ID` fallback is bypassed.
- **Evidence**: `packages/opencode/src/plugin/request.ts:1654,883-890`; `packages/core/src/constants.ts:67`.
- **Impact**: Prompt-cache misses, broken session affinity, quota misattribution for accounts without a managed project.
- **Fix Direction**: Fall back to resolved managed project or `ANTIGRAVITY_DEFAULT_PROJECT_ID`, or fail with a clear login error; if synthetic is needed, generate once and cache per account.

#### #9: Claude `messages[]` prefill guard appends Gemini-shaped `parts`
- **Severity**: High
- **Confidence**: Minority (2 members)
- **Members Reported**: [GPT 5.5 Creative, GPT 5.4 high]
- **Issue**: When a Claude `messages[]` conversation ends on an assistant turn, the plugin pushes `{ role: "user", parts: [...] }`. Anthropic `messages[]` require `content`, not `parts`, producing an invalid payload.
- **Evidence**: `packages/opencode/src/plugin/request.ts:1086-1091,1640-1644` (vs the `content`-based sanitizer at `543-553`).
- **Impact**: Malformed request / rejection for Claude continuation turns.
- **Fix Direction**: Append `{ role: "user", content: [{ type: "text", text: "[Continue]" }] }`; add regression tests.

#### #10: Thinking-block sentinels `{ text: "." }` are format-invalid / mutate history
- **Severity**: Medium
- **Confidence**: Minority (2 members)
- **Members Reported**: [GPT 5.5 Creative, GPT 5.5 xhigh]
- **Issue**: Claude thinking-strip and recovery paths replace thinking blocks with `{ text: "." }`. Valid for Gemini `parts[]`, but Anthropic `content[]` blocks need `type: "text"`; it also injects visible dot text into conversation history (affecting model behavior / cache).
- **Evidence**: `packages/opencode/src/plugin/request-helpers.ts:918-934,1136-1140,1173-1207`; `request.ts:754-765,855-867`.
- **Impact**: Possible rejection on `messages[]`; semantic pollution of history/cache.
- **Fix Direction**: Make sentinel creation format-aware; truly omit thinking parts for Claude rather than substituting text.

#### #11: Pi lacks OpenCode parity (multi-account/quota/recovery; drops project context)
- **Severity**: High
- **Confidence**: Minority (2 members)
- **Members Reported**: [XAI Composer 2.5, GPT 5.5 xhigh]
- **Issue**: Pi registers a single OAuth path with no AccountManager/rotation/quota gating/recovery/cross-model sanitization; `getApiKey` exposes only the access token and `stream.ts` calls `ensureProjectContext({ refresh: "" })`, discarding stored packed project/managed-project context.
- **Evidence**: `packages/pi/src/index.ts:52-70,96`; `packages/pi/src/stream.ts:169-174`.
- **Impact**: Hard failures surfaced to users; lost project context / cache keys; behavioral divergence from OpenCode.
- **Fix Direction**: Pass full credentials/packed refresh into `streamSimple`; document Pi as minimal or factor the shared request pipeline into core.

#### #12: Duplicate/divergent OAuth refresh; core returns bare refresh token
- **Severity**: Medium
- **Confidence**: Minority (2 members)
- **Members Reported**: [XAI Composer 2.5, Ollama Kimi 2.7]
- **Issue**: Two refresh paths (`core/antigravity/oauth.ts refreshAntigravityToken` vs `opencode/plugin/token.ts refreshAccessToken`) with different error handling/caching/persistence. Core returns `payload.refresh_token ?? refreshToken` without the `|projectId|managedProjectId` segments harnesses pack in, forcing each harness to re-append — fragile and divergent.
- **Evidence**: `packages/core/src/antigravity/oauth.ts`; `packages/opencode/src/plugin/token.ts`; `packages/pi/src/index.ts` (`refreshAntigravityCredentials`).
- **Impact**: Behavioral drift; mismatched project context if a harness forgets to re-append.
- **Fix Direction**: Consolidate on core refresh returning a structured object; thin harness persistence adapters.

#### #13: Widespread `any` casts violate the repo's own AGENTS.md
- **Severity**: Medium
- **Confidence**: Minority (2 members)
- **Members Reported**: [XAI Composer 2.5, Ollama Kimi 2.7]
- **Issue**: `request.ts`/`request-helpers.ts` use `as any` extensively (`requestPayload as any`, `part as any`, `block as any`) despite AGENTS.md prohibiting it — defeats type safety on the transform pipeline.
- **Evidence**: `packages/opencode/src/plugin/request.ts`, `request-helpers.ts` (numerous casts).
- **Impact**: Subtle transform bugs (thinking, tool pairing, usage) slip past the type checker.
- **Fix Direction**: Narrow `unknown` + type guards or proper Gemini/Claude payload interfaces.

#### #14: Pi SSE parser is line-break fragile / drops frames silently
- **Severity**: Medium
- **Confidence**: Minority (2 members)
- **Members Reported**: [XAI Composer 2.5, Ollama Kimi 2.7]
- **Issue**: `parseGeminiSse` replaces `\r\n`→`\n` and splits on `\n\n`; payloads with `\n\n` inside string values split incorrectly, and JSON parse errors are swallowed with no metric/log, so partial corruption looks like a normal short completion. (Note: project memory #6184 records frames are CRLF-separated and wrapped under a `response` key — worth verifying the parser against the real wire format.)
- **Evidence**: `packages/pi/src/stream.ts` (`parseGeminiSse`, `parseFrame` catch).
- **Impact**: Dropped/garbled chunks presented as successful short responses.
- **Fix Direction**: Frame on double-CRLF after a complete frame; count/log dropped frames; synthesize an error if `finishReason` never arrives.

---

## Notable solo findings (1 member)

High severity:
- **File lock degrades to a no-op fallback** if `proper-lockfile` fails to expose `lock` (`storage.ts getLockFunction`) — concurrent processes can corrupt the account file. *(XAI)*
- **`fetch(Request)` / `fetch(URL)` bypasses the interceptor** — only string URLs are matched, so auth/transform/quota/redaction are skipped for `Request`/`URL` inputs. *(GPT 5.5 xhigh)*
- **Tool-ID matching falls back to function name then "first orphan"** in `fixToolResponseGrouping` — a response can attach to the wrong call when a function is called multiple times (silent tool-result corruption). *(Ollama Kimi 2.7)*
- **Fingerprint headers advertised but never sent** — only a `User-Agent` is composed on the antigravity path; the Electron UA + `X-Goog-Api-Client` + `Client-Metadata` are dead code, so rotation/identity is weaker than documented. *(Ollama Minimax M3)*
- **`version.ts` fetches the runtime User-Agent from a non-Google Cloud Run URL** with no cert/hash pinning and silent fallback — supply-chain/MITM risk on every startup. *(Ollama Minimax M3)*

Medium severity:
- **Claude `*-thinking` SKU aliases to the non-thinking model**, so `isClaudeThinking` is computed from the resolved id and Claude-thinking behavior (beta header, budgets, snake_case config) is disabled. *(GPT 5.5 Creative)*
- **`ensureThoughtSignature` unconditionally injects `SKIP_THOUGHT_SIGNATURE`**, masking invalid/corrupted thinking signatures instead of validating. *(Ollama Kimi 2.7)*
- **Disk signature-cache TTL is effectively ignored** — disk hits are immediately expired by `memory_ttl_seconds`. *(GPT 5.5 xhigh)*
- **Gemini schema sanitizer preserves `oneOf`/`allOf`/`default`/`examples`** the Antigravity cleaner treats as unsupported; existing `functionDeclarations` bypass full normalization. *(GPT 5.5 xhigh)*
- **`providerOptions.google.googleSearch` is parsed but never passed** to `applyGeminiTransforms`, so grounding silently does nothing. *(GPT 5.5 Creative)*
- **Synthetic 200 SSE error response** disguises unrecoverable failures as successful turns and fabricates `usageMetadata`. *(Ollama Kimi 2.7)*
- **Module-level global state** (warmup sets, rate-limit maps, toast flags) is process-wide, not per session — concurrent subagents share cooldowns/suppress toasts. *(XAI)*
- **Cross-model sanitizer strips any `signature` ≥ 50 chars**, not only `type === "thinking"` parts. *(XAI)*
- **Error retry-header / preview-access rewrite logic is dead** — `transformAntigravityResponse` returns early for `{ error }` bodies before reaching it. *(GPT 5.4 high)*
- **`tool_pairing` "recovery" only shows a toast** — no actual recovery, and the header is only set on non-streaming responses; `detectErrorType` doesn't list it as recoverable. *(Ollama Minimax M3)*
- **`token.ts` persists the short-lived access token to disk** and has no compare-and-swap on refresh-token rotation across parallel processes. *(Ollama Minimax M3)*

Plus ~18 additional Low-severity solo findings from Ollama Minimax M3 (double body-logging to debug files, duplicate `applyToolPairingFixes` call, quota 403/4xx retry gaps, `clampInt` allowing disabled active index, unbounded `debugLines`, schema `cleaned.type = "object"` overwrite clobbering array/oneOf, model-resolver missing tier aliases, etc.). See the archived member file for the full list.

---

## Summary table

| # | Finding | Severity | Agreement | Members |
|---|---------|----------|-----------|---------|
| 1 | AGY socket transport lifecycle defects | High | Majority | 5 |
| 2 | OAuth state/PKCE not validated | High | Majority | 4 |
| 3 | Account persistence merge loses deletions/state | High | Majority | 4 |
| 4 | Hardcoded OAuth client_secret | Critical | Minority | 3 |
| 5 | Pi unsanitized tool schemas | High | Minority | 3 |
| 6 | Debug/dump leaks prompts | High | Minority | 3 |
| 7 | Plaintext refresh-token storage | High | Minority | 2 |
| 8 | Per-request synthetic project ID | High | Minority | 2 |
| 9 | Claude messages[] appends `parts` | High | Minority | 2 |
| 10 | Thinking-block sentinel format-invalid | Medium | Minority | 2 |
| 11 | Pi lacks parity / drops project ctx | High | Minority | 2 |
| 12 | Divergent OAuth refresh / bare token | Medium | Minority | 2 |
| 13 | Widespread `any` casts | Medium | Minority | 2 |
| 14 | Pi SSE parser fragile | Medium | Minority | 2 |
| S* | 5 High + 11 Medium + ~18 Low solo findings | — | Solo | 1 |

## Priority recommendations

**Fix first (security / data integrity):**
- #4 Hardcoded client_secret (Critical) — remediate before further publishing.
- #2 OAuth state/PKCE validation (High, Majority).
- #3 Account persistence merge / deletion loss (High, Majority).
- #7 Plaintext refresh tokens, #6 dump/debug leakage — credential exposure surface.
- Solo-High: file-lock no-op fallback, `version.ts` unpinned fetch.

**Fix next (wire-format correctness):**
- #1 AGY transport lifecycle (High, Majority — 5 members).
- #5 Pi tool-schema sanitization, #9 Claude `messages[]` shape, #8 synthetic project ID, #10 thinking sentinels.
- Solo-High: `fetch(Request)` bypass, tool-ID mispairing.

**Quality / robustness backlog:**
- #11 Pi parity, #12 refresh consolidation, #13 `any` casts, #14 Pi SSE parser, and the Medium/Low solo findings.

**Verification note:** All findings are source-based; none were runtime-verified by the council. Several (e.g. #4's exploitability, #1's socket-leak paths, #14 against the real CRLF wire format) warrant a confirming source/runtime check before code changes — consistent with this project's evidence-before-fix bar.
