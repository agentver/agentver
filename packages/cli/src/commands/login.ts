import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { URL } from 'node:url'
import type { LoginResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import open from 'open'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { saveCredentials } from '../registry/auth.js'
import { getRegistryUrl } from '../registry/client.js'
import {
  DEFAULT_PLATFORM_URL,
  getPlatformUrl,
  readConfig,
  writeConfig,
} from '../registry/config.js'
import { checkOnline, showOfflineError } from '../utils/network.js'

const AUTH_TIMEOUT_MS = 120_000

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function generateState(): string {
  return randomBytes(16).toString('hex')
}

type TokenResponse = {
  access_token: string
  token_type: string
}

type CallbackResult = {
  code: string
  returnedState: string
}

function startCallbackServer(expectedState: string): Promise<{
  port: number
  waitForCallback: () => Promise<CallbackResult>
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    let callbackResolve: (result: CallbackResult) => void
    let callbackReject: (error: Error) => void

    const callbackPromise = new Promise<CallbackResult>((res, rej) => {
      callbackResolve = res
      callbackReject = rej
    })

    const server = createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }

      const url = new URL(req.url, `http://localhost`)
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(authResultPage(false, `Authentication failed: ${error}`))
        callbackReject(new Error(`Authentication failed: ${error}`))
        return
      }

      if (!code || !returnedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(authResultPage(false, 'Missing code or state parameter.'))
        callbackReject(new Error('Missing code or state parameter in callback'))
        return
      }

      if (returnedState !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(authResultPage(false, 'State mismatch — possible CSRF attack.'))
        callbackReject(new Error('State mismatch — possible CSRF attack'))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(authResultPage(true, 'Authentication successful! You can close this tab.'))
      callbackResolve({ code, returnedState })
    })

    server.on('error', (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`))
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine callback server port'))
        return
      }

      resolve({
        port: address.port,
        waitForCallback: () => callbackPromise,
        close: () => {
          server.closeAllConnections()
          server.close()
        },
      })
    })
  })
}

function authResultPage(success: boolean, message: string): string {
  const colour = success ? '#22c55e' : '#ef4444'
  const icon = success ? '&#10003;' : '&#10007;'
  return `<!DOCTYPE html>
<html>
<head><title>Agentver CLI</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa;">
  <div style="text-align:center;">
    <div style="font-size:3rem;color:${colour};">${icon}</div>
    <p style="font-size:1.1rem;margin-top:1rem;">${message}</p>
  </div>
</body>
</html>`
}

async function exchangeCodeForToken(
  registryUrl: string,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<TokenResponse> {
  const tokenUrl = `${registryUrl.replace('/api/v1', '')}/auth/token`

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error')
    throw new Error(`Token exchange failed (${response.status}): ${errorBody}`)
  }

  return response.json() as Promise<TokenResponse>
}

function resolveBaseUrl(urlArg: string | undefined): string {
  if (urlArg) return urlArg
  const configured = getPlatformUrl()
  if (configured) return configured
  return getRegistryUrl().replace('/api/v1', '')
}

function resolveApiUrl(urlArg: string | undefined): string {
  if (urlArg) return `${urlArg}/api/v1`
  const configured = getPlatformUrl()
  if (configured) return `${configured}/api/v1`
  return getRegistryUrl()
}

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Authenticate with the Agentver registry')
    .argument('[url]', 'Platform URL')
    .option('--token <key>', 'API key for CI/CD authentication')
    .action(async (url: string | undefined, options: { token?: string }) => {
      const token = options.token?.trim()

      const effectiveUrl = url ?? getPlatformUrl() ?? DEFAULT_PLATFORM_URL
      if (!getPlatformUrl() || url) {
        writeConfig({ ...readConfig(), platformUrl: effectiveUrl })
      }

      if (options.token !== undefined) {
        if (!token) {
          if (isJSONMode()) {
            outputError('VALIDATION_ERROR', 'Token must not be empty.')
            process.exit(1)
          }

          process.stderr.write(chalk.red('Token must not be empty.\n'))
          process.exit(1)
        }

        saveCredentials({ apiKey: token })
        const target = url ?? getPlatformUrl()

        if (isJSONMode()) {
          outputSuccess<LoginResult>({
            user: { id: '', email: '', name: '' },
          })
          return
        }

        console.log(chalk.green('Saved API key. You are now authenticated.'))
        if (target) {
          console.log(chalk.dim(`Connected to ${target}`))
        }
        return
      }

      if (!(await checkOnline())) {
        if (isJSONMode()) {
          outputError('OFFLINE', 'Unable to reach the Agentver registry')
          process.exit(1)
        }
        showOfflineError()
        process.exit(1)
      }

      if (isJSONMode()) {
        outputError(
          'INTERACTIVE_REQUIRED',
          'OAuth login requires an interactive terminal. Use --token for non-interactive authentication.'
        )
        process.exit(1)
      }

      const baseUrl = resolveBaseUrl(url)
      const apiUrl = resolveApiUrl(url)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = generateCodeChallenge(codeVerifier)
      const state = generateState()

      const spinner = createSpinner('Starting authentication...').start()

      let callbackServer: Awaited<ReturnType<typeof startCallbackServer>> | undefined

      const cleanup = (): void => {
        callbackServer?.close()
      }

      process.on('SIGINT', () => {
        cleanup()
        spinner.fail('Authentication cancelled.')
        process.exit(1)
      })

      try {
        callbackServer = await startCallbackServer(state)
        const { port } = callbackServer
        const redirectUri = `http://localhost:${port}/callback`

        const authUrl =
          `${baseUrl}/auth/cli` +
          `?code_challenge=${encodeURIComponent(codeChallenge)}` +
          `&state=${encodeURIComponent(state)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}`

        spinner.text = 'Opening browser for authentication...'
        console.log(chalk.dim(`\n  If the browser doesn't open, visit:\n  ${authUrl}\n`))

        await open(authUrl)

        spinner.text = 'Waiting for authentication in browser...'

        let authTimeout: ReturnType<typeof setTimeout> | undefined
        const { code } = await Promise.race([
          callbackServer.waitForCallback(),
          new Promise<never>((_resolve, reject) => {
            authTimeout = setTimeout(() => {
              reject(new Error('Authentication timed out after 120 seconds'))
            }, AUTH_TIMEOUT_MS)
          }),
        ])
        clearTimeout(authTimeout)

        spinner.text = 'Exchanging authorisation code for token...'

        const tokenResponse = await exchangeCodeForToken(apiUrl, code, codeVerifier, redirectUri)

        saveCredentials({ token: tokenResponse.access_token })
        spinner.succeed('Authenticated successfully.')

        const connectedUrl = url ?? getPlatformUrl()
        if (connectedUrl) {
          console.log(chalk.dim(`Connected to ${connectedUrl}`))
        }

        process.exit(0)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        spinner.fail(`Authentication failed: ${message}`)
        process.exit(1)
      } finally {
        cleanup()
      }
    })
}
