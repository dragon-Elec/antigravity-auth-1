import { getPublicModelDefinitions } from '@cortexkit/antigravity-auth-core'

/**
 * Bridges the shared core model registry onto the OpenCode 2 provider catalog.
 *
 * The core registry is the single source of truth for model IDs, display names,
 * limits, modalities, and thinking variants — the same definitions the 1.x
 * plugin publishes and the standalone CLI consumes. Keeping that role here means
 * the catalog, the request resolver, and the CLI can never drift apart.
 */

/** Runtime shape of the host's provider transform editor (probed on 2.0.19). */
export interface ProviderModelEditorInput {
  info: {
    id: string
    name: string
    integrationID?: string
    [key: string]: unknown
  }
  models: Array<Record<string, unknown>>
}

type CoreModelDefinition = {
  id: string
  name: string
  reasoning: boolean
  attachment: boolean
  tool_call: boolean
  temperature: boolean
  release_date: string
  limit: { context: number; output: number }
  modalities: { input: string[]; output: string[] }
  cost: { input: number; output: number }
  options: Record<string, unknown>
  variants?: Record<
    string,
    {
      thinkingLevel?: string
      thinkingConfig?: Record<string, unknown>
      disabled?: boolean
    }
  >
}

/**
 * Convert one core registry definition into a host Model.Info.
 * The host rewrites foreign providerIDs on add(), so definitions can be built
 * provider-agnostically and reused for any provider ID.
 */
export function toHostModelInfo(
  def: CoreModelDefinition,
): Record<string, unknown> {
  const variants = Object.entries(def.variants ?? {})
    .filter(([, variant]) => variant.disabled !== true)
    .map(([id, variant]) => ({
      id,
      settings: {
        ...(variant.thinkingLevel
          ? { thinkingLevel: variant.thinkingLevel }
          : {}),
        ...(variant.thinkingConfig
          ? { thinkingConfig: variant.thinkingConfig }
          : {}),
      },
    }))

  return {
    id: def.id,
    modelID: def.id,
    name: def.name,
    reasoning: def.reasoning,
    attachment: def.attachment,
    temperature: def.temperature,
    tool_call: def.tool_call,
    release_date: def.release_date,
    limit: { context: def.limit.context, output: def.limit.output },
    modalities: {
      input: [...def.modalities.input],
      output: [...def.modalities.output],
    },
    cost: { input: def.cost.input, output: def.cost.output },
    options: { ...def.options },
    ...(variants.length > 0 ? { variants } : {}),
  }
}

export function antigravityModelInfos(): Array<Record<string, unknown>> {
  return Object.values(getPublicModelDefinitions()).map((def) =>
    toHostModelInfo(def as CoreModelDefinition),
  )
}
