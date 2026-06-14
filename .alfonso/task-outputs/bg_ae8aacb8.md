---
task_id: bg_ae8aacb8
agent: council-member
session_id: ses_13d3f611bffcVADhfXxmutSlny
parent_session_id: ses_13d3ff609ffes4Cx0dUt2qXdxc
status: running
completed_at: unknown
---

[user] 2026-06-13T20:51:04.062Z
## Solo Analysis Mode
You MUST do ALL exploration yourself using your available read/search tools.
- Do NOT use task or any delegation tool under any circumstances
- Do NOT delegate to explore, librarian, or any other subagent
- Do NOT spawn background tasks
- Search the codebase directly — you have full read-only access to every file
- This mode produces the most thorough analysis because you see every result firsthand


## Analysis Intent: AUDIT

You are conducting an **audit** — your goal is to find discrete issues, risks, or violations.

**Focus:**
- Search for problems, anti-patterns, security risks, correctness issues, or violations of stated requirements
- Each finding must be a distinct, actionable item with concrete evidence
- Severity determines priority: critical (blocks/breaks), high (significant risk), medium (should fix), low (nice to fix)
- For each finding, provide the specific location (reference, section, or component where it occurs)
- State your confidence: high (clear evidence), medium (likely but needs verification), low (suspicion, investigate further)
- **This is a broad sweep, not a targeted trace.**

**Analytical standards:** Support claims with concrete evidence. State confidence (high/medium/low) for key assertions. Note caveats and limitations.

**Structure your response as:**
```
<COUNCIL_MEMBER_RESPONSE>
## Finding 1: [Title]
- **Severity**: critical/high/medium/low
- **Location**: [specific reference — e.g. component, section, endpoint, rule]
- **Confidence**: high/medium/low
- **Issue**: [what is wrong and why it matters]
- **Evidence**: [concrete reference, snippet, or observation that proves the issue]
- **Suggested Fix**: [actionable recommendation]

## Finding 2: [Title]
...

## Summary
[Total findings by severity. Overall risk assessment with confidence levels.]
</COUNCIL_MEMBER_RESPONSE>
```

## Analysis Question

Perform a full audit of this plugin/codebase: the CortexKit Antigravity Auth monorepo. This is a bun/npm workspace monorepo with three publishable packages:
- packages/core (@cortexkit/antigravity-auth-core): harness-agnostic transport, fingerprint, constants, oauth, auth, project, transform/, model-registry, model-types
- packages/opencode (@cortexkit/opencode-antigravity-auth): the OpenCode plugin — intercepts fetch() to generativelanguage.googleapis.com, transforms to Antigravity wire format, handles auth/quota/recovery/multi-account rotation
- packages/pi (@cortexkit/pi-antigravity-auth): pi extension registering a "google-antigravity" provider

Core domain: OAuth token exchange and refresh for Google Antigravity, request/response transformation between Gemini API format and the Antigravity wire format (streamGenerateContent SSE), Claude thinking-block handling, schema sanitization, session recovery (synthetic tool_result injection), quota checking, multi-account load balancing with per-account device fingerprints, and a raw-socket AGY transport.

Audit scope — review the codebase broadly and surface issues with severity ratings. Focus areas:
1. Correctness bugs: request/response transformation, SSE parsing, thinking-block and thoughtSignature handling, token usage accounting, schema sanitization, cross-model payload sanitization.
2. Auth & security: OAuth token handling, token storage, fingerprint generation, credential leakage in logs/dumps, file locking for concurrent account access.
3. Concurrency & robustness: multi-account rotation, capacity/quota retry logic, restart/interruption edge cases, race conditions in storage/cache, stream lifecycle and abort handling.
4. Error handling: graceful degradation, retry/rotation triggers, error classification, silent failures.
5. Code quality & maintainability: the core/opencode/pi split, re-export shims, duplication across harnesses, type safety (any/ts-ignore usage), dead code.
6. API contract fidelity: header ordering/styles (antigravity vs gemini-cli), request envelope structure, wire format compliance, model/budget mappings.

For each finding, give: severity (Critical/High/Medium/Low), file/location, the concrete problem, evidence (cite source), and a recommended fix. Inspect the actual source — do not speculate. Prioritize correctness and security issues that would cause real failures, credential leaks, or wire-format rejections.

[assistant] 2026-06-13T20:51:04.135Z
The user wants me to perform a full audit of the CortexKit Antigravity Auth monorepo. This is a comprehensive audit across correctness, security, concurrency, error handling, code quality, and API contract fidelity.

I'm in solo analysis mode - I must do all exploration myself, no delegation.

Let me start by exploring the repository structure and then dive into the focus areas systematically.
Exploring the monorepo structure and auditing critical areas.

[assistant] 2026-06-13T20:51:05.843Z
Good, I have the package structure. Let me explore the core package source extensively - auth, oauth, fingerprint, storage, accounts, transform, transport, etc.

[assistant] 2026-06-13T20:51:07.422Z
The grep tool failed - I need to use read and list directory to explore. Let me search manually by reading files and using read on key modules.

[assistant] 2026-06-13T20:51:08.961Z
Let me continue exploring transform, request handling, thinking blocks, recovery, gemini-dump for credential leaks, constants for client secret, and compare opencode vs core duplication.

[assistant] 2026-06-13T20:51:10.418Z
I need to continue digging: storage lock fallback, recovery, schema sanitization, opencode/plugin duplicates vs core, fetch interceptor, debug logging tokens, @ts-ignore via read on specific files

[assistant] 2026-06-13T20:51:12.356Z
Let me continue auditing - plugin fetch interceptor, logResponseBody, storage lock fallback, opencode vs core duplication, request-helpers schema, SSE streaming in opencode, pi convert, accounts save without lock on some paths

[assistant] 2026-06-13T20:51:14.332Z
Storage lock fallback when proper-lockfile fails to load is concerning - line 24 returns no-op lock. Let me verify saveAccounts and concurrent access.

Also need: deepFilterThinkingBlocks, pi multi-account, opencode duplicate of core, token in request body logs.

Search for @ts-ignore and as any via read/grep alternative - list opencode plugin folder and read key files.

Check storage lock noop
Check opencode constants vs core
Check pi stream for missing abort

[assistant] 2026-06-13T20:51:16.944Z
Need more files - streaming in opencode, lock fallback, saveAccounts, fingerprint in pi, deepFilterThinkingBlocks, accounts save race, formatBodyPreviewForLog for tokens in body

[assistant] 2026-06-13T20:51:19.078Z
Let me find more issues:
- logResponseBody - does it log full bodies?
- saveAccounts merge without lock on load path
- pi build aliases core from source not dist
- thinking strip for claude - keep_thinking vs strip
- getLockFunction fallback no-op lock
- JSON.parse on account storage without zod validation

[assistant] 2026-06-13T20:51:21.218Z
loadAccountsUnsafe is called INSIDE withFileLock during saveAccounts - but loadAccountsUnsafe does NOT acquire lock itself. Good - no deadlock from nested lock on same path.

But wait - loadAccounts() at line 610 does NOT use withFileLock! Only save uses lock. So concurrent save + load can race - read during write might get partial file (unlikely with atomic rename) or old content. Actually read without lock during atomic write could read old file until rename completes - OK.

If two processes: both save with lock - OK. One load without lock while other saves - reads might happen between temp write and rename - still reads old file until rename. Good.

Race: Process A loadAccounts (no lock) reads. Process B saveAccounts locks, merges with loadAccountsUnsafe, writes. Process A had stale data - application level issue.

saveAccounts merge: incoming overwrites fields on matching refreshToken - could lose rate limit state if incoming is stale in-memory AccountManager vs disk?

Let me check requestSaveToDisk debouncing and save race.

Also pi extension: no multi-account, single OAuth credentials from pi - OK by design but divergence.

pi ensureProjectContext with empty refresh - uses only access token - need to verify project discovery works.

core cross-model sanitizer strips Claude signatures on gemini target from part.signature if length >= 50 - might break claude thinking on wrong path?

Let me read save debounce and logResponseBody for stream consumption.

Also check: storage lock fallback no-op when proper-lockfile fails to load - line 24 _cachedLock = async () => async () => {} - CRITICAL if import fails, no locking!

Let me verify proper-lockfile import path.

@ts-expect-error in recovery - only one found.

Search for empty catch blocks.

packages/core vs opencode transform duplication - opencode has ./transform/ and imports from core via shims?

Read opencode transform directory - is it duplicate of core?

Also ANTIGRAVITY_DEFAULT_PROJECT_ID hardcoded - business accounts risk.

JSON.parse in loadAccounts without try in merge path - it's in try/catch in loadAccountsUnsafe.

Finding: debug body preview logs full request body including prompts - not just auth redaction.

Gemini dump writes full request body unredacted to file - only headers redacted in metadata, request file is raw body line 247.

Cross-model: stripClaudeThinkingFields deletes signature from thinking blocks when sanitizing FOR gemini - good. But stripClaude on claude target strips gemini metadata - good.

warmupAttemptedSessionIds - module level unbounded? MAX_WARMUP_SESSIONS = 1000 in plugin - trackWarmupAttempt probably caps.

Let me read trackWarmupAttempt and transform response SSE.

Also opencode plugin fetch while loop - infinite retry without max?

Read plugin.ts offset 2100 limit 300

[assistant] 2026-06-13T20:51:26.462Z
Let me check saveAccounts with lock holding loadAccountsUnsafe - does loadAccountsUnsafe acquire lock? No - it's called inside withFileLock from saveAccounts. But loadAccounts() is separate and doesn't use lock on read path!

**Finding**: loadAccounts() reads without file lock while saveAccounts uses lock. Race: read during write could get partial/corrupt JSON.

**Finding**: mergeAccountStorage on save merges incoming with existing by refresh token - if delete operation uses saveAccounts by mistake accounts come back - they have saveAccountsReplace for that.

**Finding**: cross-model sanitizer stripClaudeThinkingFields deletes signature >= 50 chars from non-thinking parts too (line 95-99)

**Pi package**: refreshAntigravityCredentials only uses first segment of refresh - loses projectId if only in refresh string... actually it preserves project segments after first |

**Pi**: No multi-account, no schema sanitization from opencode request-helpers - buildGeminiRequest in convert.ts may be simpler

**Opencode plugin.ts**: Module-level state (warmupAttemptedSessionIds, rate limit maps) shared across all requests in process - child sessions note in comments

**Constants**: Hardcoded rising-fact-p41fc default project id in repo

**OAuth decodeState**: No try/catch on JSON.parse - malformed state throws

**authorizeAntigravity state**: base64url in URL - good

Let me read convert.ts for pi and check if thinking stripped, and loadAccounts race. Also check @ts-expect-error in recovery and storage lock fallback no-op.

[assistant] 2026-06-13T20:51:30.501Z
Pi convert doesn't use cleanJSONSchemaForAntigravity - tools may fail on pi harness.

Let me check pi convert for tools schema

[assistant] 2026-06-13T20:51:32.233Z
I have enough for a comprehensive audit. Let me also note:
- saveAccounts calls loadAccountsUnsafe inside lock - but loadAccountsUnsafe doesn't use lock - good for nested read during write
- loadAccounts is NOT locked - race on read during concurrent writes could get partial JSON? atomic write should prevent partial reads on most FS
- Stale lock: 10s stale - multiple opencode instances

Pi: no schema sanitization on tool parametersJsonSchema - raw passthrough

Core vs opencode duplication: transform in both packages/core and packages/opencode

Let me verify opencode has its own transform copy

[assistant] 2026-06-13T20:51:34.186Z
I have enough for a comprehensive audit report. Let me compile findings.

Key findings:

1. **Critical: OAuth client secret in source** - constants.ts lines 4-9 - public repo credential

2. **Critical/High: Refresh tokens in plaintext JSON** - antigravity-accounts.json - by design but high risk if backups leak

3. **High: proper-lockfile fallback is no-op** - storage.ts line 24 - if lock fails to load, concurrent writes unsynchronized

4. **High: loadAccounts inside withFileLock calls loadAccountsUnsafe without re-lock** - actually withFileLock holds lock, loadAccountsUnsafe reads without lock - that's OK within same lock holder. But saveAccounts calls loadAccountsUnsafe inside lock - good.

5. **High: Pi package - no schema sanitization** - convert.ts passes tool.parameters directly - wire rejections

6. **High: Pi - single account OAuth only** - no multi-account rotation unlike opencode

7. **High: Debug logs full request bodies** - debug.ts formatBodyPreviewForLog on meta.body - can include prompts; headers masked but body not redacted for refresh tokens in body (unlikely in body)

8. **High: Gemini dump writes full request body unredacted** - gemini-dump.ts writeFileSync context.files.request, input.body - only headers redacted in metadata

9. **Medium: Module-level process state** - warmupAttemptedSessionIds, rate limit maps, plugin session - multi-instance in same process could cross-talk (unlikely)

10. **Medium: logRateLimitSnapshot uses family as claude|gemini keys** but rateLimitResetTimes uses gemini-antigravity, gemini-cli - wrong snapshot display

11. **Medium: requestSaveToDisk silently resolves on lock contention** - data loss risk for rate limit state

12. **Medium: Pi oauth refresh strips project segments handling** - actually preserves - OK

13. **Medium: cross-model sanitizer stripClaudeThinkingFields deletes signature >=50 chars even on non-thinking parts line 95-99

14. **Medium: any/types in request.ts, request-helpers - maintainability

15. **Low: AGENTS.md says no semicolons but codebase uses them in core

16. **Low: Hardcoded default project id rising-fact-p41fc

17. **High: OAuth state in URL base64 - no signature on state, PKCE verifier in state - standard OAuth but state is client-side only

18. **Medium: saveAccounts merge can spread incoming over existing including refreshToken overwrite from merge - need to check - incoming acc spreads over existingAcc - if bad incoming could overwrite tokens?

19. **Critical correctness: Pi missing Client-Metadata / full antigravity envelope fields** - stream uses minimal envelope - userAgent "antigravity" - may be OK per MITM

20. **High: OpenCode opencode duplicates token refresh** - packages/opencode/src/plugin/token.ts vs core refreshAntigravityToken - drift risk

21. **Medium: Chunked SSE transport - pi cancels body after finishReason - good fix documented

22. **High: Invalid_grant removes account but race with other instances saving merge

23. **Low: @ts-expect-error in recovery.ts

24. **Medium: Cache warmup probe sends full request twice - cost/latency

25. **Security: ANTIGRAVITY_CLIENT_SECRET in npm package dist if constants bundled

Let me verify opencode bundles constants with secret in dist
<COUNCIL_MEMBER_RESPONSE>

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

</COUNCIL_MEMBER_RESPONSE>
