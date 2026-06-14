## Finding 1: Claude Sonnet “thinking” model is resolved as non-thinking and gets the wrong thinking config
- **Severity**: high
- **Location**: `packages/core/src/model-registry.ts:217-224`, `packages/core/src/transform/model-resolver.ts:251-276`, `packages/opencode/src/plugin/request.ts:989-990,1223-1242,1688-1700`
- **Confidence**: high
- **Issue**: `claude-sonnet-4-6-thinking` aliases to `claude-sonnet-4-6`, then OpenCode determines `isClaudeThinking` from the resolved model only. This disables Claude-thinking-specific behavior such as `anthropic-beta`, interleaved thinking hints, max-token handling, and snake_case Claude thinking config.
- **Evidence**: The registry maps `"claude-sonnet-4-6-thinking"` and tiered variants to `"claude-sonnet-4-6"`, while `request.ts` computes `isClaudeThinking = isClaudeThinkingModel(resolved.actualModel)`. Later generic Gemini-style `{ includeThoughts, thinkingBudget }` is used unless `isClaudeThinking` is true.
- **Suggested Fix**: Preserve a separate `isClaudeThinking` flag from the requested model / resolver result, or stop aliasing the thinking SKU to a non-thinking ID unless all Claude-thinking behavior keys off `resolved.isThinkingModel`.

## Finding 2: Anthropic `messages[]` recovery appends Gemini-shaped `parts`
- **Severity**: high
- **Location**: `packages/opencode/src/plugin/request.ts:1086-1091,1640-1644`
- **Confidence**: high
- **Issue**: When a Claude `messages[]` conversation ends with an assistant message, the plugin appends `{ role: "user", parts: [...] }`. Anthropic-style messages require `content`, not `parts`, so this can produce invalid request payloads.
- **Evidence**: The `contents[]` and `messages[]` guards both push the same Gemini-style shape with `parts`.
- **Suggested Fix**: For `messages[]`, append `{ role: "user", content: [{ type: "text", text: "[Continue]" }] }`.

## Finding 3: Thinking-block sentinels are invalid for Anthropic `messages[]`
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/request-helpers.ts:922-934,1173-1178,1201-1207`; `packages/opencode/src/plugin/request.ts:855-867`
- **Confidence**: high
- **Issue**: Multiple Claude/message recovery paths replace thinking blocks with `{ text: "." }`. That is valid for Gemini `parts[]`, but Anthropic `messages[].content[]` blocks should include `type: "text"`. The sanitizer later preserves these blocks as-is.
- **Evidence**: `filterContentArray` and `ensureThinkingBeforeToolUseInMessages` emit plain `{ text: "." }` even when operating on `messages[]`.
- **Suggested Fix**: Make sentinel creation format-aware: Gemini parts use `{ text: "." }`; Anthropic content uses `{ type: "text", text: "." }`.

## Finding 4: pi package sends unsanitized tool schemas with the wrong field name
- **Severity**: high
- **Location**: `packages/pi/src/convert.ts:24-29,131-140`
- **Confidence**: high
- **Issue**: pi emits tool declarations as `{ parametersJsonSchema: tool.parameters }`. The Antigravity/Gemini format used elsewhere expects sanitized `parameters`, with unsupported JSON Schema keywords removed or transformed. This can cause tool-bearing pi requests to be rejected.
- **Evidence**: OpenCode/core transforms wrap tools into `{ functionDeclarations: [{ name, description, parameters }] }` and sanitize schemas; pi bypasses that and passes raw schema as `parametersJsonSchema`.
- **Suggested Fix**: Reuse the core Gemini schema sanitizer/wrapper and output `parameters`, not `parametersJsonSchema`.

## Finding 5: Google Search provider option is extracted but never applied
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin/request-helpers.ts:830-837`; `packages/opencode/src/plugin/request.ts:909-912,1451-1456`
- **Confidence**: high
- **Issue**: `providerOptions.google.googleSearch` is parsed into `variantConfig.googleSearch`, and `PrepareRequestOptions.googleSearch` exists, but `applyGeminiTransforms()` is called without a `googleSearch` option. Configured grounding/search will silently do nothing.
- **Evidence**: The Gemini transform supports `googleSearch`, but the call passes only `model`, `normalizedThinking`, `tierThinkingBudget`, and `tierThinkingLevel`.
- **Suggested Fix**: Pass `googleSearch: variantConfig?.googleSearch ?? options?.googleSearch` into `applyGeminiTransforms`.

## Finding 6: OAuth PKCE verifier is embedded in the OAuth `state`
- **Severity**: medium
- **Location**: `packages/core/src/antigravity/oauth.ts:118-155,224-230`
- **Confidence**: high
- **Issue**: The PKCE verifier is base64url-encoded into the authorization URL’s `state` parameter and decoded during token exchange. This weakens PKCE because the verifier travels with the browser URL and callback URL.
- **Evidence**: `authorizeAntigravity()` sets `state` to `encodeState({ verifier: pkce.verifier, projectId })`; `exchangeAntigravity()` recovers the verifier by `decodeState(state)`.
- **Suggested Fix**: Store the verifier locally keyed by a random state nonce; put only the nonce in `state`.

## Finding 7: “Switch account” on transient failures may reselect the same account
- **Severity**: medium
- **Location**: `packages/opencode/src/plugin.ts:2755-2764,2769-2824`; `packages/opencode/src/plugin/accounts.ts:584-600`
- **Confidence**: medium
- **Issue**: On endpoint/network failures, the code sets `shouldSwitchAccount = true`, but it only cools down/rate-limits the account after several failures. The next outer iteration can select the same current account again because it is still considered available.
- **Evidence**: `getCurrentOrNextForFamily()` returns the current account if not limited/cooling down; the catch path marks cooldown only when `shouldCooldown` is true.
- **Suggested Fix**: When switch is requested, either exclude the previous account for the next selection or mark a short transient cooldown immediately.

## Finding 8: Gemini dump writes raw prompts/responses to shared temp storage without explicit secure modes
- **Severity**: low
- **Location**: `packages/opencode/src/plugin/gemini-dump.ts:13-14,217,247-249,265-281`
- **Confidence**: high
- **Issue**: `/gemini-dump` captures full request and raw response bodies, including prompts, tool outputs, and generated content, under `os.tmpdir()` by default. Files are written without explicit `0600` mode and the directory without `0700`.
- **Evidence**: Default dump dir is `tmpdir()/opencode-antigravity-gemini-dumps`; request/response are written/appended raw.
- **Suggested Fix**: Create dump directories with `0700`, files with `0600`, and add an explicit warning before enabling dumps.

## Summary
Findings: **3 high**, **4 medium**, **1 low**. Overall risk is **moderate-high**: the most serious issues are wire-format correctness problems around Claude thinking and pi tool schemas, plus a real OAuth PKCE design weakness. Confidence is high for the format/config findings because they are directly evidenced in source paths.