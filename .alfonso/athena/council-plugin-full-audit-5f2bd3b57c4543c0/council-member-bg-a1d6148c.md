## Finding 1: OAuth callback `state` is not validated against the original login attempt
- **Severity**: high
- **Location**: `packages/opencode/src/plugin.ts:722-750, 3408-3445, 3611-3643`; `packages/pi/src/index.ts:34-47`; `packages/core/src/antigravity/oauth.ts:125-136, 224-230`
- **Confidence**: high
- **Issue**: The callback handler trusts whatever `state` arrives in the pasted/redirect URL and uses it as the PKCE verifier source. That makes `state` a transport container, not a CSRF/session-binding token. A different auth flow’s `code`+`state` pair can be injected and exchanged.
- **Evidence**: `parseOAuthCallbackInput()` returns `url.searchParams.get("state") ?? fallbackState`; pi does the same (`if (stateParam) state = stateParam`); `exchangeAntigravity()` immediately calls `decodeState(state)` and uses the decoded `verifier`. There is no equality check against the originally issued state/verifier.
- **Suggested Fix**: Persist the originally generated state/verifier locally and require an exact state match on callback before exchange. Do not accept callback-provided state as authoritative.

## Finding 2: Raw-socket transport does not honor `Content-Length`
- **Severity**: high
- **Location**: `packages/core/src/agy-transport.ts:263-301, 351-389`; exercised by `packages/core/src/project.ts:142-149` and `packages/opencode/src/plugin/quota.ts:224-233`
- **Confidence**: high
- **Issue**: The transport parses `chunked` and `gzip`, but never parses or enforces `Content-Length`. For non-chunked responses it reads until socket end, which is not a valid HTTP/1.1 message boundary on keep-alive connections.
- **Evidence**: `parseResponseHead()` records only `chunked` and `gzip`; `buildResponseStream()` just pipes the socket and only closes on stream end/error. No byte limiter is created from `Content-Length`.
- **Suggested Fix**: Parse `Content-Length` and wrap the body in a bounded reader, or force `Connection: close` and verify server behavior. Add tests for fixed-length, keep-alive JSON responses.

## Finding 3: Claude `messages[]` assistant-prefill guard appends an invalid message shape
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/request.ts:1086-1091, 1640-1644`; contrasted with `packages/opencode/src/plugin/request.ts:543-553`
- **Confidence**: high
- **Issue**: The fallback that appends a synthetic user turn for Claude `messages[]` mode uses `parts` instead of `content`. That means the guard meant to prevent ending on an assistant message can emit a malformed message.
- **Evidence**: The code pushes `{ role: "user", parts: [...] }` into `messages`; elsewhere the same file’s `messages` sanitizer reads `messageRecord.content` and leaves non-`content` messages unchanged.
- **Suggested Fix**: In `messages[]` mode append `{ role: "user", content: [{ type: "text", text: "[Continue]" }] }`, and add regression tests for both wrapped and unwrapped `messages[]` payloads.

## Finding 4: Revoked/deleted accounts are not durably removed because save path re-merges old disk state
- **Severity**: high
- **Location**: `packages/opencode/src/plugin.ts:1893-1900`; `packages/opencode/src/plugin/accounts.ts:1074-1106`; `packages/opencode/src/plugin/storage.ts:767-788`
- **Confidence**: high
- **Issue**: Runtime account removal is persisted through `saveToDisk()`, but `saveToDisk()` calls `saveAccounts()`, which merges incoming state with the existing file. Removed accounts can therefore be merged back from disk instead of staying deleted.
- **Evidence**: On `invalid_grant`, plugin calls `accountManager.removeAccount(account)` then `accountManager.saveToDisk()`. `saveToDisk()` calls `saveAccounts(storage)`, and `saveAccounts()` explicitly does `const merged = existing ? mergeAccountStorage(existing, storage) : storage`. `saveAccountsReplace()` exists specifically for destructive writes.
- **Suggested Fix**: Use replace semantics when the in-memory pool shrinks/removes entries, or teach `saveAccounts()` to support explicit deletions.

## Finding 5: “Start fresh” login still merges the old account file instead of replacing it
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin.ts:786-791, 866-879, 3518-3520`; `packages/opencode/src/plugin/storage.ts:767-788`
- **Confidence**: high
- **Issue**: The CLI path claims fresh login should replace existing accounts, but the first persisted write still goes through merge-saving, so prior accounts can survive.
- **Evidence**: `persistAccountPool()` comments say `replaceAll` means “start with empty accounts”, but it still ends with `await saveAccounts(...)`. The caller passes `persistAccountPool([result], isFirstAccount && startFresh)`.
- **Suggested Fix**: When `replaceAll` is true, call `saveAccountsReplace()` for that write path.

## Finding 6: Error-response rewrite logic is dead after an early return
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/request.ts:1883-1955, 1964-1967`
- **Confidence**: high
- **Issue**: `transformAntigravityResponse()` returns immediately for normal `{ error: ... }` bodies, so later logic that extracts `RetryInfo` headers and rewrites preview-access errors never runs for typical failures.
- **Evidence**: Inside `if (!response.ok)`, the `if (errorBody?.error)` block returns at lines 1931-1935. The later `error.details` retry-header logic and `rewriteAntigravityPreviewAccessError()` call are after that return.
- **Suggested Fix**: Compute retry headers / preview rewrites before returning error responses, and add tests asserting those headers/messages appear on failing responses.

## Summary
- **High**: 3
- **Medium**: 3
- **Low**: 0

Overall risk is **high**, with highest-confidence issues in OAuth callback integrity, HTTP transport correctness, and account-pool persistence semantics. This audit is source-based; I did not run the code, but the cited defects are directly visible in the implementation.