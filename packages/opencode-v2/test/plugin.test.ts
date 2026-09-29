import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SessionHttpRequest } from '@opencode-ai/plugin/promise/session'

import plugin, {
  createOpenCodeV2AntigravityPlugin,
  upsertOAuthAccount,
} from '../src/plugin.ts'

function successResponse(): Response {
  return new Response(
    `data: ${JSON.stringify({
      response: {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'title' }] },
            finishReason: 'STOP',
          },
        ],
      },
    })}\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('opencode-v2-antigravity-auth plugin entry', () => {
  test('exports the plugin contract shape', () => {
    expect(plugin).toBeTypeOf('object')
    expect(plugin.id).toBe('cortexkit.antigravity-auth')
    expect(plugin.setup).toBeTypeOf('function')
  })

  test('stores the bare OAuth refresh token while preserving account identity state', () => {
    const result = upsertOAuthAccount(
      {
        version: 4,
        accounts: [
          {
            email: 'account@example.test',
            refreshToken: 'old-refresh',
            projectId: 'old-project',
            addedAt: 1,
            lastUsed: 2,
            enabled: false,
            rateLimitResetTimes: {},
            accountIneligible: true,
            accountIneligibleReason: 'ACCOUNT_INELIGIBLE',
          },
        ],
        activeIndex: 0,
        activeIndexByFamily: { claude: 0, gemini: 0 },
      },
      {
        type: 'success',
        refresh: 'new-refresh|new-project|managed-project',
        access: 'new-access',
        expires: 100,
        email: 'account@example.test',
        projectId: 'new-project',
      },
      50,
    )

    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0]).toMatchObject({
      refreshToken: 'new-refresh',
      projectId: 'new-project',
      managedProjectId: 'managed-project',
      addedAt: 1,
      lastUsed: 50,
      enabled: true,
      accountIneligible: false,
      verificationRequired: false,
    })
    expect(result.accounts[0]?.accountIneligibleReason).toBeUndefined()
    expect(result.accounts[0]?.verificationRequiredReason).toBeUndefined()
    expect(result.activeIndexByFamily).toEqual({ claude: 0, gemini: 0 })
  })

  test('rejects OAuth completion when account persistence fails', async () => {
    type OAuthMethodDefinition = {
      authorize: () => Promise<{ callback: Promise<unknown> }>
    }
    let oauthMethod: OAuthMethodDefinition | undefined
    const adapter = createOpenCodeV2AntigravityPlugin({
      authorizeAntigravity: async () => ({
        url: 'https://accounts.example/authorize?state=oauth-state',
        verifier: 'oauth-verifier',
        projectId: '',
      }),
      waitForAntigravityCode: async (state) => {
        expect(state).toBe('oauth-state')
        return 'oauth-code'
      },
      exchangeAntigravity: async () => ({
        type: 'success',
        refresh: 'oauth-refresh|oauth-project',
        access: 'oauth-access',
        expires: Date.now() + 60_000,
        projectId: 'oauth-project',
      }),
      mutateAccountStorage: async () => {
        throw new Error('disk write failed')
      },
    })
    const registration = { dispose: async () => {} }
    const cleanup = await adapter.setup({
      session: {
        hook: async () => registration,
      },
      integration: {
        transform: async (transform: unknown) => {
          ;(
            transform as (draft: {
              method: {
                update: (definition: OAuthMethodDefinition) => void
              }
            }) => void
          )({
            method: {
              update: (definition) => {
                oauthMethod = definition
              },
            },
          })
          return registration
        },
      },
    } as never)

    try {
      expect(oauthMethod).toBeDefined()
      const authorization = await oauthMethod!.authorize()
      await expect(authorization.callback).rejects.toThrow('disk write failed')
    } finally {
      if (cleanup) await cleanup()
    }
  })

  test('routes the host title model through a supported Antigravity model', async () => {
    const configDir = process.env.OPENCODE_CONFIG_DIR
    if (!configDir) throw new Error('OPENCODE_CONFIG_DIR is not set')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'antigravity-accounts.json'),
      `${JSON.stringify({
        version: 4,
        accounts: [
          {
            refreshToken: 'title-refresh',
            projectId: 'title-project',
            addedAt: 1,
            lastUsed: 0,
            enabled: true,
            rateLimitResetTimes: {},
          },
        ],
        activeIndex: 0,
        activeIndexByFamily: { claude: 0, gemini: 0 },
      })}\n`,
    )

    let httpRequestHook:
      | ((event: SessionHttpRequest) => Promise<void>)
      | undefined
    let routedModel: string | undefined
    const adapter = createOpenCodeV2AntigravityPlugin({
      refreshAntigravityToken: async (refresh) => ({
        refresh,
        access: 'title-access',
        expires: Date.now() + 60_000,
      }),
      ensureProjectContext: async (auth) => ({
        auth,
        projectId: 'title-project',
        effectiveProjectId: 'title-project',
      }),
      send: async ({ envelope }) => {
        routedModel = envelope.model
        return successResponse()
      },
    })
    const registration = { dispose: async () => {} }
    const cleanup = await adapter.setup({
      session: {
        hook: async (name: string, callback: unknown) => {
          if (name === 'http.request') {
            httpRequestHook = callback as (
              event: SessionHttpRequest,
            ) => Promise<void>
          }
          return registration
        },
      },
      integration: {
        transform: async () => registration,
      },
    } as never)

    try {
      const event = {
        sessionID: 'title-session',
        agent: 'title-agent',
        model: {
          providerID: 'google',
          id: 'gemini-3.5-flash-lite',
        },
        kind: 'title',
        request: new Request(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Create title' }] }],
            }),
          },
        ),
      }
      expect(httpRequestHook).toBeTypeOf('function')
      await httpRequestHook!(event as never)
      expect(new URL(event.request.url).hostname).toBe('127.0.0.1')
      const response = await fetch(event.request)
      expect(response.ok).toBe(true)
      expect(await response.text()).toContain('title')
      expect(routedModel).toBe('gemini-3.5-flash-extra-low')
    } finally {
      if (cleanup) await cleanup()
    }
  })
})
