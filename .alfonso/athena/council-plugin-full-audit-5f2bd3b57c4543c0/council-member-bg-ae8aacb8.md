## Finding 1: OAuth client secret committed in source
- **Severity**: critical
- **Location**: `packages/core/src/constants.ts` (`ANTIGRAVITY_CLIENT_ID`, `ANTIGRAVITY_CLIENT_SECRET`)
- **Confidence**: high
- **Issue**: The Antigravity OAuth **client secret** is hard-coded and shipped with `@cortexkit/antigravity-auth-core` (and re-exported by OpenCode/Pi shims). Anyone with the package or repo can use it in token exchanges; rotation requires a release and does not revoke past leaks.
- **Evidence**:
```4:9:packages/core/src/constants.ts
export const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
// ...
export const ANTIGRAVITY_CLIENT_SECRET = "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";
```
- **Suggested Fix**: Treat as a public OAuth client where Google allows it, or move secrets to env/user config, document threat model, and coordinate secret rotation with Google; avoid baking rotatable secrets into published artifacts.

## Finding 2: Refresh tokens stored in plaintext on disk
- **Severity**: high
- **Location**: `packages/opencode/src/plugin/storage.ts` (`antigravity-accounts.json`, `saveAccounts` / `loadAccounts`)
- **Confidence**: high
- **Issue**: Account pool persists **full refresh tokens** (and packed project IDs) in JSON. `chmod 0o600` and `.gitignore` help but do not protect backups, sync tools, malware, or overly broad file reads.
- **Evidence**: `AccountMetadataV3.refreshToken`, atomic write with mode `0o600`; `GITIGNORE_ENTRIES` includes `antigravity-accounts.json`.
- **Suggested Fix**: OS keychain/credential store for refresh tokens, or encrypt at rest with a machine-local key; minimize token lifetime; document backup/sync risks.

## Finding 3: File lock degrades to no-op if `proper-lockfile` fails to load
- **Severity**: high
- **Location**: `packages/opencode/src/plugin/storage.ts` (`getLockFunction`)
- **Confidence**: high
- **Issue**: If the CJS `proper-lockfile` import does not expose `lock`, the fallback is `async () => async () => {}`, so **multi-process OpenCode instances** can read-merge-write `antigravity-accounts.json` concurrently and lose rate-limit state, fingerprints, or tokens.
- **Evidence**:
```18:25:packages/opencode/src/plugin/storage.ts
  _cachedLock = (fn as LockFunction) || (async () => async () => {})
```
- **Suggested Fix**: Fail closed (refuse save/load) if lock is unavailable; add a startup self-test; log at error level when using fallback (prefer removing fallback in production builds).

## Finding 4: Pi harness sends tool schemas without Antigravity sanitization
- **Severity**: high
- **Location**: `packages/pi/src/convert.ts` (`convertTools` / `buildGeminiRequest`)
- **Confidence**: high
- **Issue**: OpenCode applies `cleanJSONSchemaForAntigravity` and related transforms; Pi passes `tool.parameters` straight into `parametersJsonSchema`. Requests with `$ref`, `const`, `additionalProperties`, etc. are likely to hit **INVALID_ARGUMENT** or VALIDATED-mode failures on the wire.
- **Evidence**:
```131:140:packages/pi/src/convert.ts
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters as Record<string, unknown>,
      })),
```
- **Suggested Fix**: Reuse core/opencode schema cleaning in Pi (import from core transform/helpers) before envelope serialization.

## Finding 5: Pi extension lacks OpenCode multi-account, quota, and recovery stack
- **Severity**: high
- **Location**: `packages/pi/src/index.ts`, `packages/pi/src/stream.ts`
- **Confidence**: high
- **Issue**: Pi registers a single OAuth provider path with no `AccountManager`, rotation on 429, verification gating, session recovery, or cross-model sanitization. Behavioral parity with the OpenCode plugin is **not** met; failures surface as hard errors to the user.
- **Evidence**: Pi only uses `streamCortexKitAntigravity` + core transport/oauth; no imports from opencode `accounts`, `recovery`, or `request-helpers`.
- **Suggested Fix**: Document Pi as “single-account, minimal transform” or factor shared request pipeline into core and call it from both harnesses.

## Finding 6: Gemini dump writes full request bodies (prompt/session content)
- **Severity**: high
- **Location**: `packages/opencode/src/plugin/gemini-dump.ts` (`dumpGeminiRequest`)
- **Confidence**: high
- **Issue**: When enabled (`OPENCODE_ANTIGRAVITY_GEMINI_DUMP=1` or `/gemini-dump on`), the **entire** Antigravity request JSON is written to disk; only dump **metadata** headers are redacted. This is a deliberate debug feature but a serious **local data exposure** risk if left on.
- **Evidence**: `writeFileSync(context.files.request, input.body, "utf8")`; metadata uses `redactForDump` on headers only; status text warns about prompt content.
- **Suggested Fix**: Default off in production builds; redact `contents`/`systemInstruction` in request files; auto-disable after N dumps; restrict dump dir permissions.

## Finding 7: Debug mode logs large request body previews without content redaction
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/debug.ts` (`startAntigravityDebugRequest`, `formatBodyPreviewForLog`)
- **Confidence**: high
- **Issue**: Authorization headers are masked, but **body previews** (up to 12k chars) can contain full prompts, tool outputs, and PII. Debug can be forced via `OPENCODE_ANTIGRAVITY_DEBUG`.
- **Evidence**: `logDebug(... Body Preview: ${bodyPreview})` where `bodyPreview` comes from raw `meta.body` string.
- **Suggested Fix**: Apply structured redaction to bodies (truncate + hash sensitive fields); separate “verbose” tier that never logs message text by default.

## Finding 8: Debounced account save silently drops persistence on lock contention
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/accounts.ts` (`executeSave`)
- **Confidence**: high
- **Issue**: On `ELOCKED`, save errors are treated as success for waiters (`resolve()` without retry). Rate limits, verification flags, and refreshed tokens may **never hit disk** while the process continues with in-memory state.
- **Evidence**: `isStorageLockContention` branch resolves all `savePromiseResolvers` without retry.
- **Suggested Fix**: Retry with backoff; queue failed snapshot for next save; surface a one-time user warning when persistence fails.

## Finding 9: Rate-limit debug snapshot uses wrong keys for Gemini pools
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/debug.ts` (`logRateLimitSnapshot`)
- **Confidence**: high
- **Issue**: Snapshot reads `rateLimitResetTimes?.[family]` with `family` `"claude" | "gemini"`, but storage uses **`gemini-antigravity`** and **`gemini-cli`**. Operators see misleading “ready” status during incidents.
- **Evidence**: `logRateLimitSnapshot` uses `family as "claude" | "gemini"`; `RateLimitStateV3` in `storage.ts` defines separate gemini pool keys.
- **Suggested Fix**: Map family + header style to `QuotaKey` when formatting snapshots (reuse `getQuotaKey` from accounts).

## Finding 10: Duplicate OAuth refresh implementations (core vs OpenCode)
- **Severity**: medium
- **Location**: `packages/core/src/antigravity/oauth.ts` (`refreshAntigravityToken`) vs `packages/opencode/src/plugin/token.ts` (`refreshAccessToken`)
- **Confidence**: high
- **Issue**: Two paths hit `oauth2.googleapis.com/token` with different error handling, caching (`storeCachedAuth`), and persistence. Pi uses core; OpenCode plugin uses local `token.ts`—behavior and failure modes can **diverge** over time.
- **Evidence**: Core export in `packages/core/src/index.ts`; OpenCode `refreshAccessToken` with `AntigravityTokenRefreshError` and `client.auth.set`.
- **Suggested Fix**: Consolidate on core refresh + thin harness adapters for persistence.

## Finding 11: Cross-model sanitizer may strip legitimate `signature` fields on non-thinking parts
- **Severity**: medium
- **Location**: `packages/core/src/transform/cross-model-sanitizer.ts` (`stripClaudeThinkingFields`)
- **Confidence**: medium
- **Issue**: Any part with a string `signature` length ≥ 50 loses `signature`, not only `type === "thinking"`. Could break edge payloads if other block types reuse `signature`.
- **Evidence**: Lines 95–99 delete `signature` when length ≥ 50 outside thinking-type branch.
- **Suggested Fix**: Restrict deletion to thinking/redacted_thinking (and documented Gemini fields only); add regression tests.

## Finding 12: Module-level global state across requests and child sessions
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin.ts` (warmup sets, toast flags, rate-limit maps), `packages/opencode/src/plugin/request.ts` (`PLUGIN_SESSION_ID`, signature session sets)
- **Confidence**: medium
- **Issue**: Warmup attempt tracking, rate-limit dedup maps, and “all accounts blocked” toast flags are **process-wide**, not per OpenCode session. Concurrent subagents/background tasks can share cooldowns, skip warmups, or suppress toasts incorrectly.
- **Evidence**: `warmupAttemptedSessionIds`, `rateLimitStateByAccountQuota`, `softQuotaToastShown` at module scope in `plugin.ts`.
- **Suggested Fix**: Key state by session ID + account index; reset toast flags per user message or session.

## Finding 13: `request-helpers` / `request.ts` rely heavily on `any` casts
- **Severity**: low
- **Location**: `packages/opencode/src/plugin/request-helpers.ts`, `packages/opencode/src/plugin/request.ts`
- **Confidence**: high
- **Issue**: Violates repo AGENTS.md (“never use `as any`”) and increases risk of subtle transform bugs (thinking, tool pairing, usage metadata).
- **Evidence**: e.g. `request.ts` `anyBlock`, `anyPayload`; `request-helpers.ts` schema helpers typed as `any`.
- **Suggested Fix**: Introduce narrow types for Gemini contents/messages; type guards instead of casts.

## Finding 14: Hardcoded fallback cloud project ID
- **Severity**: low
- **Location**: `packages/core/src/constants.ts` (`ANTIGRAVITY_DEFAULT_PROJECT_ID`)
- **Confidence**: high
- **Issue**: Shared default project `"rising-fact-p41fc"` when discovery fails may route traffic to a **non-user** project context for some account types—correctness/quota surprises.
- **Evidence**: Constant documented for business/workspace accounts; used in project/oauth flows.
- **Suggested Fix**: Require explicit user project configuration when discovery fails; never silently use a global default in production without loud UI warning.

## Finding 15: Pi SSE parser swallows malformed frames silently
- **Severity**: low
- **Location**: `packages/pi/src/stream.ts` (`parseGeminiSse` / `parseFrame`)
- **Confidence**: high
- **Issue**: JSON parse errors in SSE lines are ignored with no metric/log, making **partial stream corruption** look like a normal short completion.
- **Evidence**: `catch { // Ignore malformed SSE frames. }`
- **Suggested Fix**: Count dropped frames; if finishReason missing after errors, surface synthetic error to caller.

## Finding 16: Raw AGY transport header timeout vs unbounded body
- **Severity**: low
- **Location**: `packages/core/src/agy-transport.ts`
- **Confidence**: high
- **Issue**: Only **response headers** are timeout-bounded (default 180s); slow trickle bodies could hold sockets until abort. Pi mitigates by canceling after `finishReason`; OpenCode streaming path should ensure equivalent cancel on terminal SSE.
- **Evidence**: `DEFAULT_AGY_RESPONSE_HEADER_TIMEOUT_MS`; `buildResponseStream` pipes until end/error.
- **Suggested Fix**: Document contract; ensure all harnesses cancel body on terminal chunk or user abort (audit OpenCode `transformAntigravityResponse` parity with Pi).

## Summary
| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 5 |
| Medium | 6 |
| Low | 4 |

**Overall risk (high confidence):** The monorepo’s **OpenCode** path is relatively mature (locking, redacted debug headers, thinking/schema transforms, rotation), but **credential handling** (embedded client secret + plaintext refresh tokens) and **lock no-op fallback** are the top security/correctness risks. **Pi** is materially behind on wire-format and operations (schema sanitization, multi-account, recovery). **Debug/dump features** can leak full prompts locally if enabled.

**Medium-confidence areas needing targeted tests:** concurrent multi-instance saves under real `proper-lockfile`; OpenCode streaming cancel after terminal SSE vs Pi; cross-model sessions switching Claude ↔ Gemini 3 with cached signatures.