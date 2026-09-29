// Loopback OAuth callback listener for the Antigravity login flow.
// Google redirects to http://localhost:51121/oauth-callback (the redirect URI
// registered for the Antigravity OAuth client), so the port is fixed.

import type { ServerResponse } from 'node:http'
import { createServer } from 'node:http'

const CALLBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/oauth-callback'
const CALLBACK_PORT = 51121
const CALLBACK_TIMEOUT_MS = 10 * 60_000

interface AntigravityCodeOptions {
  port?: number
  timeoutMs?: number
}

// The callback page only acknowledges that the authorization code arrived; the
// token exchange and account persistence happen afterwards in the plugin, so the
// page must not claim the account was added.
const PAGE_OK = `<!doctype html><meta charset="utf-8"><title>Antigravity authorization received</title>
<body style="font-family:system-ui;padding:2rem"><h2>Authorization received</h2><p>Return to OpenCode — the login result is reported there.</p></body>`
const PAGE_FAIL = `<!doctype html><meta charset="utf-8"><title>Antigravity login failed</title>
<body style="font-family:system-ui;padding:2rem"><h2>Login failed</h2><p>Return to OpenCode and try again.</p></body>`

function respond(response: ServerResponse, status: number, page: string): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-type': 'text/html; charset=utf-8',
  })
  response.end(page)
}

/**
 * Starts listening immediately and resolves with the authorization code once
 * Google redirects back with the matching state.
 */
export function waitForAntigravityCode(
  expectedState: string,
  options: AntigravityCodeOptions = {},
): Promise<string> {
  if (!expectedState) throw new Error('OAuth state is empty')
  const port = options.port ?? CALLBACK_PORT
  const timeoutMs = options.timeoutMs ?? CALLBACK_TIMEOUT_MS

  return new Promise<string>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const server = createServer((request, response) => {
      let url: URL
      try {
        url = new URL(request.url ?? '/', `http://${CALLBACK_HOST}:${port}`)
      } catch {
        respond(response, 400, PAGE_FAIL)
        return
      }
      if (url.pathname !== CALLBACK_PATH) {
        respond(response, 404, PAGE_FAIL)
        return
      }
      if (url.searchParams.get('state') !== expectedState) {
        respond(response, 400, PAGE_FAIL)
        return
      }
      if (url.searchParams.has('error')) {
        respond(response, 400, PAGE_FAIL)
        finish(
          undefined,
          new Error(
            `Google authorization failed: ${url.searchParams.get('error')}`,
          ),
        )
        return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        respond(response, 400, PAGE_FAIL)
        return
      }
      respond(response, 200, PAGE_OK)
      finish(code)
    })

    function finish(code?: string, error?: unknown): void {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      server.close(() => {})
      if (error) {
        reject(error)
        return
      }
      if (!code) {
        reject(new Error('Antigravity authorization returned no code'))
        return
      }
      resolve(code)
    }

    server.once('error', (error) => finish(undefined, error))
    server.listen(port, CALLBACK_HOST, () => {
      timer = setTimeout(
        () =>
          finish(undefined, new Error('Antigravity authorization timed out')),
        timeoutMs,
      )
    })
  })
}
