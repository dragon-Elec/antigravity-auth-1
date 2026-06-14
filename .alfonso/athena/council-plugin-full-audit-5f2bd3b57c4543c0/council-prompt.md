
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