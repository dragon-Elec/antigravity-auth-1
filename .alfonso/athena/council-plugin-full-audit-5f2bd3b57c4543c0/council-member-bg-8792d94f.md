## Finding 1: `fetch(Request)` calls bypass the interceptor
- **Severity**: high
- **Location**: `packages/opencode/src/plugin/request.ts:897-899`, `packages/opencode/src/plugin.ts:1593-1597`
- **Confidence**: high
- **Issue**: The interceptor only recognizes string URLs. `fetch(new Request("https://generativelanguage.googleapis.com/..."))` is passed through unmodified, so OAuth headers, request transformation, quota handling, and key redaction are skipped.
- **Evidence**: `isGenerativeLanguageRequest(input)` returns true only when `typeof input === "string"`. The plugin fetch wrapper returns `fetch(input, init)` when that guard fails.
- **Suggested Fix**: Normalize `RequestInfo | URL` to a URL string and clone/merge `Request` headers/body before interception. Add tests for `Request` and `URL` inputs.

## Finding 2: OAuth callback state is not bound to the initiated login
- **Severity**: high
- **Location**: `packages/core/src/antigravity/oauth.ts:152-155`, `224-247`; `packages/opencode/src/plugin.ts:3356-3364`, OAuth listener flow around callback state handling
- **Confidence**: high
- **Issue**: The PKCE verifier is embedded in the returned `state`, and the exchange accepts whatever `state` comes back; callers do not compare it with the state they initiated. In remote environments the callback listener can bind `0.0.0.0`, increasing login-CSRF/account-injection risk.
- **Evidence**: `exchangeAntigravity()` decodes `verifier` from caller-supplied state and immediately uses it as `code_verifier`.
- **Suggested Fix**: Store expected `state`/verifier server-side per login attempt, reject mismatches, and bind the callback to loopback unless explicitly configured.

## Finding 3: Debug/dump features persist sensitive prompts and responses without strong protections
- **Severity**: high
- **Location**: `packages/opencode/src/plugin/debug.ts:241-244`, `281-284`, `407-410`; `packages/opencode/src/plugin/gemini-dump.ts:14`, `247-267`
- **Confidence**: high
- **Issue**: Debug logs and Gemini dumps write request/response bodies, including prompt/session/tool content, to files. Dumps default to `/tmp/...`; file creation does not set `0600` or directory `0700`.
- **Evidence**: `Body Preview`, `Response Body`, `.request.json`, and `.response.raw` are written directly; dump redaction only targets selected header keys.
- **Suggested Fix**: Use private config/cache dirs, strict file modes, content redaction for secrets/base64/tool output, and explicit user confirmation for full-body dumps.

## Finding 4: Pi package bypasses core tool/schema transformation
- **Severity**: high
- **Location**: `packages/pi/src/convert.ts:24-29`, `131-141`; `packages/pi/src/stream.ts:176-207`
- **Confidence**: high
- **Issue**: Pi sends tools as `functionDeclarations[].parametersJsonSchema` and does not call core Gemini schema normalization/wrapping. Antigravity’s strict wire format expects sanitized `parameters`.
- **Evidence**: `buildGeminiRequest()` emits `parametersJsonSchema`; `stream.ts` wraps and sends it directly.
- **Suggested Fix**: Reuse core `applyGeminiTransforms`/schema sanitization in Pi and emit `functionDeclarations[].parameters`.

## Finding 5: Account deletion can race with debounced saves and restore credentials
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/storage.ts:825-834`; `packages/opencode/src/plugin/accounts.ts:1108-1115`; `packages/opencode/src/plugin.ts:3356-3364`
- **Confidence**: high
- **Issue**: `clearAccounts()` unlinks storage without a lock, while `AccountManager.requestSaveToDisk()` can later write the in-memory account list back.
- **Evidence**: Destructive delete calls `clearAccounts()` but does not cancel pending debounced saves or clear the active manager.
- **Suggested Fix**: Lock destructive operations, atomically replace with empty storage, cancel/flush pending saves, and clear in-memory account state.

## Finding 6: Disk signature cache TTL is effectively ignored
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/cache/signature-cache.ts:313-319`, `157-166`
- **Confidence**: high
- **Issue**: Entries are loaded from disk if within `disk_ttl_seconds`, but `retrieve()` immediately expires them using `memory_ttl_seconds`.
- **Evidence**: Loaded disk entries keep their old timestamp; `retrieve()` deletes when `age > memoryTtlMs`.
- **Suggested Fix**: Separate memory and disk TTL handling or promote disk hits with a fresh memory timestamp while validating against disk TTL.

## Finding 7: Gemini schema sanitizer is inconsistent and may emit unsupported fields
- **Severity**: medium
- **Location**: `packages/core/src/transform/gemini.ts:27-50`, `88-96`; `packages/opencode/src/plugin/request.ts:1450-1456`
- **Confidence**: medium
- **Issue**: Gemini transformation preserves `oneOf`/`allOf`, `default`, and `examples`, while the Antigravity cleaner elsewhere treats several of these as unsupported. Existing `functionDeclarations` can also bypass full schema normalization.
- **Evidence**: `toGeminiSchema()` explicitly preserves/defaults those fields; OpenCode Gemini tool path uses `applyGeminiTransforms()`.
- **Suggested Fix**: Use one strict schema sanitizer across Claude/Gemini/Pi, flatten unions, remove unsupported fields, and add rejection-regression tests.

## Finding 8: Claude “strip thinking” path injects semantic dot sentinels
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/request-helpers.ts:918-934`, `1136-1140`; `packages/opencode/src/plugin/request.ts:754-765`
- **Confidence**: high
- **Issue**: The stated behavior is to strip Claude thinking blocks, but the code replaces them with `{ text: "." }`. This changes conversation history and can affect model behavior/cache contents.
- **Evidence**: `stripAllThinkingBlocks()` maps thinking/signature parts to a dot text part.
- **Suggested Fix**: Truly omit thinking parts for Claude, or keep cache/index metadata out-of-band instead of adding visible text.

## Finding 9: Pi stream drops persisted project/managed-project context
- **Severity**: medium
- **Location**: `packages/pi/src/index.ts:52-70`, `96`; `packages/pi/src/stream.ts:169-174`
- **Confidence**: high
- **Issue**: Login stores packed refresh/project segments, but `getApiKey` exposes only the access token; streaming calls `ensureProjectContext({ refresh: "" })`.
- **Evidence**: `stream.ts` passes an empty refresh string, disabling cache keys and stored project recovery.
- **Suggested Fix**: Pass full OAuth credentials or packed refresh into `streamSimple`, and persist any managed-project updates.

## Finding 10: Raw AGY transport does not honor abort during connect
- **Severity**: medium
- **Location**: `packages/core/src/agy-transport.ts:405-423`; connect helpers `143-237`
- **Confidence**: high
- **Issue**: Abort listeners are attached only after TLS/proxy connection completes. A canceled request can still hang until the connect/header timeout.
- **Evidence**: `connectTls()` runs before `options.signal?.addEventListener("abort", ...)`.
- **Suggested Fix**: Pass `AbortSignal` into connect/proxy handshake functions and race connect/header waits against abort, destroying sockets immediately.

## Summary
Findings: 0 critical, 4 high, 6 medium, 0 low. Overall risk is moderate-to-high: the largest risks are interception bypass, OAuth callback binding/state handling, sensitive debug artifacts, and Pi’s incomplete reuse of core transforms.