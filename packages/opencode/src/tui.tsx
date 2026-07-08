/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Show } from "solid-js"

interface AccountData {
  email?: string
  refreshToken?: string
  lastUsed?: number
  enabled?: boolean
  cachedQuota?: {
    claude?: { remainingFraction?: number; resetTime?: string }
    "gemini-pro"?: { remainingFraction?: number; resetTime?: string }
    "gemini-flash"?: { remainingFraction?: number; resetTime?: string }
  }
  verificationRequired?: boolean
  cooldownReason?: string
  cooldownUntil?: number
}

interface AccountStatus {
  email: string
  isActive: boolean
  tokenStatus: "valid" | "cooldown" | "invalid"
  lastUsed: string
  claude: number
  pro: number
  flash: number
  proReset: string
  flashReset: string
  claudeReset: string
  cooldownReason?: string
  cooldownRemaining?: string
  issues: string[]
}

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "never"
  const diffMs = Date.now() - timestamp
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

function formatResetTime(resetTimeStr: string | undefined): string {
  if (!resetTimeStr) return ""
  const ms = Date.parse(resetTimeStr) - Date.now()
  if (isNaN(ms) || ms <= 0) return ""
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainingMins = mins % 60
  return `${hours}h${remainingMins}m`
}

function formatCooldownRemaining(until: number | undefined): string {
  if (!until) return ""
  const ms = until - Date.now()
  if (ms <= 0) return ""
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h${mins % 60}m`
}

async function loadAccounts(configPath: string): Promise<AccountStatus[]> {
  const path = join(configPath, "antigravity-accounts.json")
  const content = await readFile(path, "utf8")
  const data = JSON.parse(content)
  const accounts: AccountData[] = data.accounts || []
  const activeIndex = typeof data.activeIndex === "number" ? data.activeIndex : 0
  
  return accounts.map((acc, i) => {
    const quota = acc.cachedQuota || {}
    const claudeFrac = quota.claude?.remainingFraction ?? 1
    const proFrac = quota["gemini-pro"]?.remainingFraction ?? 1
    const flashFrac = quota["gemini-flash"]?.remainingFraction ?? 1
    
    const issues: string[] = []
    if (!acc.email) issues.push("no email")
    if (acc.enabled === false) issues.push("disabled")
    if (acc.verificationRequired) issues.push("verification required")
    
    let tokenStatus: "valid" | "cooldown" | "invalid" = "valid"
    if (acc.cooldownReason) tokenStatus = "cooldown"
    else if (!acc.refreshToken || acc.verificationRequired) tokenStatus = "invalid"
    
    return {
      email: acc.email || "[no email]",
      isActive: i === activeIndex,
      tokenStatus,
      lastUsed: formatRelativeTime(acc.lastUsed),
      claude: Math.round(claudeFrac * 100),
      pro: Math.round(proFrac * 100),
      flash: Math.round(flashFrac * 100),
      proReset: proFrac < 1 ? formatResetTime(quota["gemini-pro"]?.resetTime) : "",
      flashReset: flashFrac < 1 ? formatResetTime(quota["gemini-flash"]?.resetTime) : "",
      claudeReset: claudeFrac < 1 ? formatResetTime(quota.claude?.resetTime) : "",
      cooldownReason: acc.cooldownReason,
      cooldownRemaining: formatCooldownRemaining(acc.cooldownUntil),
      issues,
    }
  })
}

function StatusDialog(props: { api: TuiPluginApi; accounts: AccountStatus[] }) {
  const t = () => props.api.theme.current
  
  const totalAccounts = props.accounts.length
  const healthyAccounts = props.accounts.filter(a => a.tokenStatus === "valid" && a.issues.length === 0).length
  const issueCount = props.accounts.filter(a => a.issues.length > 0 || a.tokenStatus !== "valid").length
  
  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingRight={2}>
      <box justifyContent="center" width="100%" marginBottom={1}>
        <text fg={t().accent} bold>⚡ Antigravity Status</text>
      </box>
      
      {props.accounts.map((acc) => (
        <box flexDirection="column" width="100%" marginBottom={1}>
          <box flexDirection="row" gap={1}>
            <Show when={acc.isActive}>
              <text fg={t().accent}>▶</text>
            </Show>
            <text fg={t().text} bold>{acc.email}</text>
            <text fg={acc.tokenStatus === "valid" ? t().success : acc.tokenStatus === "cooldown" ? t().warning : t().error}>
              {acc.tokenStatus === "valid" ? "●" : acc.tokenStatus === "cooldown" ? "⚠" : "✗"}
            </text>
            <text fg={t().textMuted}>{acc.lastUsed}</text>
          </box>
          
          <box flexDirection="row" gap={2} paddingLeft={2}>
            <text fg={t().textMuted}>C:{acc.claude.toString()}%</text>
            <box flexDirection="row" gap={0.5}>
              <text fg={t().textMuted}>P:{acc.pro.toString()}%</text>
              <Show when={acc.proReset}>
                <text fg={t().warning}>({acc.proReset})</text>
              </Show>
            </box>
            <box flexDirection="row" gap={0.5}>
              <text fg={t().textMuted}>F:{acc.flash.toString()}%</text>
              <Show when={acc.flashReset}>
                <text fg={t().warning}>({acc.flashReset})</text>
              </Show>
            </box>
          </box>
          
          <Show when={acc.cooldownReason}>
            <box paddingLeft={2}>
              <text fg={t().error}>
                ✗ Cooldown ({acc.cooldownReason}) - {acc.cooldownRemaining} remaining
              </text>
            </box>
          </Show>
          
          <Show when={acc.issues.length > 0}>
            <box paddingLeft={2}>
              <text fg={t().warning}>⚠ {acc.issues.join(", ")}</text>
            </box>
          </Show>
        </box>
      ))}
      
      <box width="100%" marginTop={1} marginBottom={1}>
        <text fg={t().border}>─────────────────────────────────────────</text>
      </box>
      
      <box flexDirection="row" gap={2}>
        <text fg={t().textMuted}>{totalAccounts.toString()} accounts</text>
        <Show when={issueCount > 0} fallback={<text fg={t().success}>• All healthy</text>}>
          <text fg={t().warning}>• {issueCount.toString()} issue{issueCount > 1 ? "s" : ""}</text>
        </Show>
      </box>
      
      <box marginTop={1} justifyContent="flex-end" width="100%">
        <text fg={t().textMuted}>Esc to close</text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: "antigravity.status",
        title: "Antigravity: Show Status",
        category: "Antigravity",
        slashName: "agstatus",
        async run() {
          try {
            const configPath = api.state.path.config
            const accounts = await loadAccounts(configPath)
            api.ui.dialog.replace(() => <StatusDialog api={api} accounts={accounts} />)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            api.ui.toast({ message: `Failed to load status: ${message}`, variant: "error" })
          }
        },
      },
    ],
    bindings: [],
  })
}

const plugin = { id: "antigravity.status", tui }
export default plugin
