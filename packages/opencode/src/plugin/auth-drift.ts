import { formatRefreshParts, isOAuthAuth, parseRefreshParts } from './auth'
import type { AccountMetadataV3, AccountStorageV4 } from './storage'
import type { AuthDetails, OAuthAuthDetails } from './types'

export type AuthStorageDriftStatus =
  | 'healthy'
  | 'restorable'
  | 'drifted'
  | 'unavailable'

export type AuthStorageDriftReason =
  | 'auth-matches-storage'
  | 'missing-opencode-auth'
  | 'non-oauth-opencode-auth'
  | 'refresh-token-not-in-storage'
  | 'no-account-storage'
  | 'no-enabled-accounts'

export interface AuthStorageDriftReport {
  status: AuthStorageDriftStatus
  reason: AuthStorageDriftReason
  account?: AccountMetadataV3
}

function isAccountEnabled(account: AccountMetadataV3): boolean {
  return account.enabled !== false
}

export function selectRestorableAccount(
  storage: AccountStorageV4 | null | undefined,
): AccountMetadataV3 | undefined {
  if (!storage || storage.accounts.length === 0) {
    return undefined
  }

  const activeAccount = storage.accounts[storage.activeIndex]
  if (activeAccount && isAccountEnabled(activeAccount)) {
    return activeAccount
  }

  return storage.accounts.find(isAccountEnabled)
}

export function buildAuthFromStoredAccount(
  account: AccountMetadataV3,
): OAuthAuthDetails {
  return {
    type: 'oauth',
    refresh: formatRefreshParts({
      refreshToken: account.refreshToken,
      projectId: account.projectId,
      managedProjectId: account.managedProjectId,
    }),
    access: '',
    expires: 0,
  }
}

/**
 * Remove the anonymous account created when a deleted host credential was
 * reinserted into the pool. Only removes the account matching the current
 * OAuth token, and only when the pool also contains identified accounts.
 */
export function reconcileAnonymousAuthAccount(
  auth: AuthDetails | undefined | null,
  storage: AccountStorageV4 | null | undefined,
): { storage: AccountStorageV4; account: AccountMetadataV3 } | undefined {
  if (!storage || storage.accounts.length < 2 || !isOAuthAuth(auth)) {
    return undefined
  }

  const authRefreshToken = parseRefreshParts(auth.refresh).refreshToken
  const anonymousIndex = storage.accounts.findIndex(
    (account) => !account.email && account.refreshToken === authRefreshToken,
  )
  if (anonymousIndex < 0) {
    return undefined
  }

  const hasIdentifiedAccount = storage.accounts.some(
    (account, index) => index !== anonymousIndex && Boolean(account.email),
  )
  if (!hasIdentifiedAccount) {
    return undefined
  }

  const activeAccount = storage.accounts[storage.activeIndex]
  const replacement =
    activeAccount &&
    activeAccount !== storage.accounts[anonymousIndex] &&
    activeAccount.enabled !== false &&
    activeAccount.email
      ? activeAccount
      : storage.accounts.find(
          (account, index) =>
            index !== anonymousIndex &&
            account.enabled !== false &&
            Boolean(account.email),
        )
  if (!replacement) {
    return undefined
  }

  const accounts = storage.accounts.filter(
    (_, index) => index !== anonymousIndex,
  )
  const replacementIndex = accounts.indexOf(replacement)
  return {
    storage: {
      version: 4,
      accounts,
      activeIndex: replacementIndex,
      activeIndexByFamily: {
        claude: replacementIndex,
        gemini: replacementIndex,
      },
    },
    account: replacement,
  }
}

export function detectAuthStorageDrift(
  auth: AuthDetails | undefined | null,
  storage: AccountStorageV4 | null | undefined,
): AuthStorageDriftReport {
  if (!storage || storage.accounts.length === 0) {
    return {
      status: 'unavailable',
      reason: 'no-account-storage',
    }
  }

  const restorableAccount = selectRestorableAccount(storage)
  if (!restorableAccount) {
    return {
      status: 'unavailable',
      reason: 'no-enabled-accounts',
    }
  }

  if (!auth) {
    return {
      status: 'restorable',
      reason: 'missing-opencode-auth',
      account: restorableAccount,
    }
  }

  if (!isOAuthAuth(auth)) {
    return {
      status: 'restorable',
      reason: 'non-oauth-opencode-auth',
      account: restorableAccount,
    }
  }

  const authRefreshToken = parseRefreshParts(auth.refresh).refreshToken
  const matchedAccount = storage.accounts.find(
    (account) => account.refreshToken === authRefreshToken,
  )
  if (matchedAccount) {
    return {
      status: 'healthy',
      reason: 'auth-matches-storage',
      account: matchedAccount,
    }
  }

  return {
    status: 'drifted',
    reason: 'refresh-token-not-in-storage',
    account: restorableAccount,
  }
}
