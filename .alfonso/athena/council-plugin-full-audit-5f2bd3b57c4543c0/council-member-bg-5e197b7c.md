## Finding 1: Hardcoded OAuth Client Secret in Publishable Package
- **Severity**: Critical
- **Location**: `packages/core/src/constants.ts`, lines 4-9
- **Confidence**: High
- **Issue**: `ANTIGRAVITY_CLIENT_SECRET` is committed as a plain string in a package that is published to npm. Distributing an OAuth client secret in installable source code exposes it to anyone who installs or inspects the package, undermining the confidentiality model of OAuth and potentially violating Google’s terms of service.
- **Evidence**: 
  ```ts
  export const ANTIGRAVITY_CLIENT_SECRET = "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";
  ```
- **Suggested Fix**: Remove the secret from source control and the published artifact. Load it from environment variables or a runtime secret manager. If Google allows a public client, use an empty/`undefined` client secret and rely on PKCE instead.

## Finding 2: Refresh Tokens Stored in Plaintext
- **Severity**: Critical
- **Location**: `packages/opencode/src/plugin/storage.ts`, `loadAccounts` / `saveAccounts` / `saveAccountsReplace`
- **Confidence**: High
- **Issue**: OAuth refresh tokens are persisted to `antigravity-accounts.json` as plaintext JSON. While the file is set to `0o600`, plaintext storage on disk is still a credential-leak risk (backups, file sync, CI artifacts, compromised user account).
- **Evidence**: `saveAccounts` writes `JSON.stringify(merged, null, 2)` directly; the schema stores `refreshToken` as a plain string.
- **Suggested Fix**: Encrypt refresh tokens at rest using a platform keychain (e.g., `keytar`, `node-keytar`) or OS credential store, or at minimum encrypt with a key derived from the user’s machine ID before writing to disk.

## Finding 3: Random Synthetic Project IDs Used as Fallback
- **Severity**: High
- **Location**: `packages/opencode/src/plugin/request.ts`, line ~1654 and `generateSyntheticProjectId`
- **Confidence**: High
- **Issue**: When no project ID is supplied, the code generates a random synthetic project ID for every request. A fluctuating `project` field in the Antigravity envelope can break backend session affinity, quota attribution, or context continuity.
- **Evidence**: 
  ```ts
  const effectiveProjectId = projectId?.trim() || (headerStyle === "antigravity" ? generateSyntheticProjectId() : "");
  ```
  `generateSyntheticProjectId` uses `crypto.randomUUID()` and random adjectives/nouns.
- **Suggested Fix**: Fall back to the resolved project context from `ensureProjectContext` (cached/hardcoded default) instead of a random value. If `project` is truly optional for Antigravity, omit it rather than fabricate a random one.

## Finding 4: Race Conditions and Stale-State Risk in Account Storage
- **Severity**: High
- **Location**: `packages/opencode/src/plugin/accounts.ts`, `requestSaveToDisk` / `saveAccounts`; `packages/opencode/src/plugin/storage.ts`, `saveAccounts`
- **Confidence**: Medium
- **Issue**: `AccountManager` batches saves via a `setTimeout`, and `saveAccounts` re-reads the file inside the lock to merge. Multiple concurrent in-memory mutations between the read and write can be lost because the merge is file-based, not object-based. Additionally, in-process updates to `AccountManager` state may not be visible to other plugin instances.
- **Evidence**: `requestSaveToDisk` defers saves; `saveAccounts` calls `loadAccountsUnsafe` then `mergeAccountStorage(existing, storage)`; other code paths hold references to account objects and mutate them.
- **Suggested Fix**: Serialize all storage mutations through a single in-memory model and use an atomic compare-and-swap (read version, modify, write if version matches) or rely on a database/file lock plus single writer to prevent lost updates.

## Finding 5: Tool ID Matching Falls Back to Function Name, Risking Wrong Pairings
- **Severity**: High
- **Location**: `packages/opencode/src/plugin/request-helpers.ts`, `fixToolResponseGrouping` (lines ~2140-2170)
- **Confidence**: High
- **Issue**: During orphan recovery, if a `functionResponse` ID is missing, the code matches by function name, then by `"unknown_function"`, then takes the first available orphan. If the same function is called multiple times, a response can be attached to the wrong call, leading to silent data corruption in tool results.
- **Evidence**:
  ```ts
  // Pass 1: Match by function name
  for (const [orphanId, orphanResp] of collectedResponses) {
    const orphanName = orphanResp.functionResponse?.name || "";
    if (orphanName === expectedName) { matchedId = orphanId; break; }
  }
  ```
- **Suggested Fix**: Preserve strict ID correlation. If IDs are missing, reject the request or re-derive IDs deterministically from call order rather than matching by name.

## Finding 6: SSE Parser in PI Package Is Line-Break Fragile
- **Severity**: Medium
- **Location**: `packages/pi/src/stream.ts`, `parseGeminiSse`
- **Confidence**: High
- **Issue**: The parser replaces `\r\n` with `\n` and splits on `\n\n`. JSON data payloads that legitimately contain `\n\n` inside string values will be split incorrectly, yielding malformed JSON and dropped chunks. The trailing-buffer flush also processes incomplete frames as if they were complete.
- **Evidence**:
  ```ts
  buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n")
  let boundary = buffer.indexOf("\n\n")
  ```
- **Suggested Fix**: Parse SSE by scanning for double-CRLF frame boundaries only after the complete frame is received, and do not treat `\n\n` inside `data:` values as frame terminators. Use a proper SSE parser or a state machine.

## Finding 7: Widespread Use of `any` and Unsafe Casts
- **Severity**: Medium
- **Location**: `packages/opencode/src/plugin/request.ts`, `packages/opencode/src/plugin/request-helpers.ts`, and others
- **Confidence**: High
- **Issue**: The project’s own `AGENTS.md` prohibits `as any`, `@ts-ignore`, and `@ts-expect-error`, yet the codebase uses `as any` extensively (e.g., `requestPayload as any`, `part as any`, `block as any`). This defeats TypeScript’s type safety and makes refactorings error-prone.
- **Evidence**: Dozens of casts such as `const anyPayload = requestPayload as any;`, `const record = part as any;`, etc.
- **Suggested Fix**: Replace `any` with narrow `unknown` + runtime type guards, or define proper interface types for Gemini/Claude payloads and use `satisfies` / typed generics.

## Finding 8: Core Refresh Function Returns Bare Refresh Tokens, Forcing Harnesses to Reconstruct Project Segments
- **Severity**: Medium
- **Location**: `packages/core/src/antigravity/oauth.ts`, `refreshAntigravityToken`; `packages/pi/src/index.ts`, `refreshAntigravityCredentials`
- **Confidence**: High
- **Issue**: `refreshAntigravityToken` is harness-agnostic and returns `payload.refresh_token ?? refreshToken` without the `|projectId|managedProjectId` segments that the opencode/pi harnesses pack into stored refresh strings. Each harness must remember to re-append project metadata; forgetting causes mismatched project context.
- **Evidence**: 
  ```ts
  return { access: payload.access_token, refresh: payload.refresh_token ?? refreshToken, expires: ... };
  ```
  The pi harness mitigates this by splitting and re-appending `projectSegments`, but this is fragile.
- **Suggested Fix**: Return a structured refresh object from core (token + project metadata) and let harnesses serialize in their own storage format, or have core accept/return the packed refresh string.

## Finding 9: Synthetic 200 Error Response Hides Real Failures
- **Severity**: Medium
- **Location**: `packages/opencode/src/plugin/request-helpers.ts`, `createSyntheticErrorResponse`
- **Confidence**: High
- **Issue**: When an unrecoverable loader error occurs, the plugin returns HTTP 200 with a synthetic SSE body containing the error as assistant text. Downstream consumers may record this as a successful turn, and fabricated `usageMetadata` can distort usage tracking.
- **Evidence**:
  ```ts
  return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200, ... });
  ```
- **Suggested Fix**: Return the original error response or a properly typed error stream; do not disguise failures as successful completions. If a synthetic response is required, add a clear `X-Antigravity-Synthetic-Error` header and avoid fabricating token counts.

## Finding 10: Model Name Resolution Logic Is Complex and Error-Prone
- **Severity**: Medium
- **Location**: `packages/core/src/transform/model-resolver.ts`, `resolveModelForHeaderStyle`
- **Confidence**: Medium
- **Issue**: The function mutates model names with regexes, tier suffixes, and `antigravity-` prefixes in multiple branches. Edge cases (e.g., already having `-preview`, unknown model aliases) can produce invalid wire model names, leading to 404s or quota misrouting.
- **Evidence**: Lines 355-414 contain nested conditionals that strip/add `-preview`, `-preview-customtools`, and tier suffixes; `isGemini35FlashModel` is checked on a tier-stripped name but the fallback model logic can still append conflicting suffixes.
- **Suggested Fix**: Refactor into a state machine or table-driven resolver with explicit unit tests for every alias permutation; add fallback validation that rejects unresolved model names before sending.

## Finding 11: `ensureThinkingBeforeToolUseInContents` Always Injects Sentinel Signature
- **Severity**: Medium
- **Location**: `packages/opencode/src/plugin/request.ts`, `ensureThinkingBeforeToolUseInContents` / `ensureThoughtSignature`
- **Confidence**: High
- **Issue**: The function determines “has signed thinking” by calling `ensureThoughtSignature`, which unconditionally replaces any thinking part’s signature with `SKIP_THOUGHT_SIGNATURE` when a session ID exists. This means unsigned/corrupted thinking is always papered over rather than validated, masking real signature problems and potentially allowing invalid context to reach the model.
- **Evidence**:
  ```ts
  if (block.type === "thinking" || block.type === "redacted_thinking") {
    return { ...block, signature: SKIP_THOUGHT_SIGNATURE };
  }
  ```
- **Suggested Fix**: Separate “validate signature” from “inject sentinel fallback”. Only inject the sentinel when a valid signature cannot be recovered from cache, and log when fallback occurs.

## Finding 12: Raw-Socket Transport Lacks Body Timeout and Pre-Connection Abort Check
- **Severity**: Medium
- **Location**: `packages/core/src/agy-transport.ts`, `fetchWithAgyCliTransport` / `buildResponseStream`
- **Confidence**: Medium
- **Issue**: The transport has a header timeout but no body/stream timeout, so a hung SSE body could keep the socket open indefinitely. It also does not check whether the abort signal is already aborted before writing the request, so a request may still be dispatched after cancellation.
- **Evidence**: `fetchWithAgyCliTransport` adds the abort listener after `connectTls` and writes `requestBytes` unconditionally.
- **Suggested Fix**: Add an optional body timeout and/or idle-read timeout; check `options.signal?.aborted` immediately after acquiring the socket and before writing.

## Summary
I found **2 critical** issues (hardcoded OAuth client secret, plaintext refresh-token storage), **4 high-severity** issues (random project IDs, storage race conditions, incorrect tool ID fallback, sentinel-signature masking), and **6 medium-severity** issues (SSE fragility, `any` casts, refresh-token segment fragility, synthetic error responses, model-name resolution complexity, raw-socket timeouts). Most critical findings are supported by direct source evidence with high confidence. The codebase would benefit from a security pass on credential handling, stricter typing, and simplifying the request-transformation pipeline to reduce correctness risks.