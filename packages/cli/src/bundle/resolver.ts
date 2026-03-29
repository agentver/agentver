import type { BundleManifest, CredentialSource } from '@agentver/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolvedCredential = {
  key: string
  source: CredentialSource
  vaultKey?: string
  envVar?: string
  oauthProvider?: string
  value?: string
  description: string
  required: boolean
  sharing: string
}

export type ResolvedMcpServer = {
  name: string
  description?: string
  transport: string
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  credentials: ResolvedCredential[]
}

export type ResolvedPackageRef = {
  name: string
  version?: string
  type: 'skill' | 'prompt' | 'rule' | 'plugin' | 'script'
  optional: boolean
}

export type ResolvedBundle = {
  name: string
  version: string
  description?: string
  packages: ResolvedPackageRef[]
  mcpServers: ResolvedMcpServer[]
  credentials: Map<string, ResolvedCredential>
  extends?: string
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a bundle manifest into a flat, actionable structure.
 *
 * Produces:
 * - A list of packages to install (skills, prompts, rules, etc.)
 * - A list of MCP servers to configure
 * - A consolidated map of credential requirements
 */
export function resolveBundle(manifest: BundleManifest): ResolvedBundle {
  const packages: ResolvedPackageRef[] = []
  const mcpServers: ResolvedMcpServer[] = []
  const credentials = new Map<string, ResolvedCredential>()

  if (manifest.includes) {
    const typeMap: Array<
      [keyof NonNullable<typeof manifest.includes>, ResolvedPackageRef['type']]
    > = [
      ['skills', 'skill'],
      ['prompts', 'prompt'],
      ['rules', 'rule'],
      ['plugins', 'plugin'],
      ['scripts', 'script'],
    ]

    for (const [key, type] of typeMap) {
      const refs = manifest.includes[key]
      if (refs) {
        for (const ref of refs) {
          packages.push({
            name: ref.name,
            version: ref.version,
            type,
            optional: ref.optional,
          })
        }
      }
    }
  }

  if (manifest.credentials) {
    for (const [key, def] of Object.entries(manifest.credentials)) {
      credentials.set(key, {
        key,
        source: 'vault',
        vaultKey: key,
        description: def.description,
        required: def.required,
        sharing: def.sharing,
      })
    }
  }

  if (manifest.mcpServers) {
    for (const serverConfig of manifest.mcpServers) {
      const serverCredentials: ResolvedCredential[] = []

      if (serverConfig.credentials) {
        for (const cred of serverConfig.credentials) {
          const resolved: ResolvedCredential = {
            key: cred.key,
            source: cred.source,
            vaultKey: cred.vaultKey,
            envVar: cred.envVar,
            oauthProvider: cred.oauthProvider,
            description: cred.description,
            required: cred.required,
            sharing: 'individual',
          }

          const topLevel = credentials.get(cred.vaultKey ?? cred.key)
          if (topLevel) {
            resolved.sharing = topLevel.sharing
            if (!resolved.description) {
              resolved.description = topLevel.description
            }
          } else {
            credentials.set(cred.key, resolved)
          }

          serverCredentials.push(resolved)
        }
      }

      mcpServers.push({
        name: serverConfig.name,
        description: serverConfig.description,
        transport: serverConfig.transport,
        command: serverConfig.command,
        args: serverConfig.args,
        url: serverConfig.url,
        headers: serverConfig.headers,
        env: serverConfig.env,
        credentials: serverCredentials,
      })
    }
  }

  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    packages,
    mcpServers,
    credentials,
    extends: manifest.extends,
  }
}

/**
 * Validate a bundle manifest for common issues before resolution.
 */
export function validateBundleManifest(manifest: BundleManifest): string[] {
  const errors: string[] = []

  if (manifest.mcpServers) {
    for (const server of manifest.mcpServers) {
      if (server.transport === 'stdio' && !server.command) {
        errors.push(`MCP server "${server.name}": stdio transport requires a command`)
      }

      if ((server.transport === 'http' || server.transport === 'sse') && !server.url) {
        errors.push(`MCP server "${server.name}": ${server.transport} transport requires a url`)
      }

      if (server.credentials && manifest.credentials) {
        for (const cred of server.credentials) {
          if (cred.source === 'vault' && cred.vaultKey && !manifest.credentials[cred.vaultKey]) {
            errors.push(
              `MCP server "${server.name}": credential "${cred.key}" references vault key "${cred.vaultKey}" which is not defined in bundle credentials`
            )
          }
        }
      }

      if (server.env) {
        const placeholderRegex = /\$\{credentials\.([a-z0-9-]+)\}/g
        for (const [envKey, envValue] of Object.entries(server.env)) {
          let match: RegExpExecArray | null
          while ((match = placeholderRegex.exec(envValue)) !== null) {
            const credKey = match[1]
            if (!credKey) continue

            const hasServerCred = server.credentials?.some(
              (c) => c.key === credKey || c.vaultKey === credKey
            )
            const hasTopLevelCred = manifest.credentials?.[credKey]

            if (!hasServerCred && !hasTopLevelCred) {
              errors.push(
                `MCP server "${server.name}": env var "${envKey}" references credential "${credKey}" which is not defined`
              )
            }
          }
        }
      }
    }
  }

  return errors
}
