// OpenCode 2's cross-platform package resolver probes a `/tui` export even when
// `oc-plugin` enables only the server entry. Keep the resolvable module inert so
// loading this package never registers a second render surface.
export const id = 'cortexkit.antigravity-auth.tui-placeholder'

export function tui(): undefined {
  return undefined
}

export default { id, tui }
