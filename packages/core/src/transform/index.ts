/**
 * Transform Module Index
 * 
 * Re-exports transform functions and types for request transformation.
 */

// Types
export type {
  ModelFamily,
  ThinkingTier,
  TransformContext,
  TransformResult,
  TransformDebugInfo,
  RequestPayload,
  ThinkingConfig,
  ResolvedModel,
  GoogleSearchConfig,
} from "./types.ts";

// Model resolution
export {
  resolveModelWithTier,
  resolveModelWithVariant,
  resolveModelForHeaderStyle,
  getModelFamily,
  MODEL_ALIASES,
  THINKING_TIER_BUDGETS,
  GEMINI_3_THINKING_LEVELS,
} from "./model-resolver.ts";
export type { VariantConfig } from "./model-resolver.ts";

// Claude transforms
export {
  isClaudeModel,
  isClaudeThinkingModel,
  configureClaudeToolConfig,
  buildClaudeThinkingConfig,
  ensureClaudeMaxOutputTokens,
  appendClaudeThinkingHint,
  normalizeClaudeTools,
  applyClaudeTransforms,
  CLAUDE_THINKING_MAX_OUTPUT_TOKENS,
  CLAUDE_INTERLEAVED_THINKING_HINT,
  computeClaudeMaxOutputTokens,
} from "./claude.ts";export type { ClaudeTransformOptions, ClaudeTransformResult } from "./claude.ts";

// Gemini transforms
export {
  isGeminiModel,
  isGemini3Model,
  isGemini25Model,
  isImageGenerationModel,
  buildGemini3ThinkingConfig,
  buildGemini25ThinkingConfig,
  buildImageGenerationConfig,
  normalizeGeminiTools,
  applyGeminiTransforms,
} from "./gemini.ts";
export type { GeminiTransformOptions, GeminiTransformResult, ImageConfig } from "./gemini.ts";

// Cross-model sanitization
export {
  sanitizeCrossModelPayload,
  sanitizeCrossModelPayloadInPlace,
  getModelFamily as getCrossModelFamily,
  stripGeminiThinkingMetadata,
  stripClaudeThinkingFields,
} from "./cross-model-sanitizer.ts";
export type { SanitizerOptions } from "./cross-model-sanitizer.ts";
