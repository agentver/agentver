/**
 * Seed data for the MCP server catalogue.
 * Run with: bunx tsx prisma/seed-mcp-catalogue.ts
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PrismaClient } from '../generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

type McpServerSeed = {
  name: string
  displayName: string
  description: string
  author: string
  sourceType: string
  sourcePackage?: string
  sourceUri?: string
  latestVersion?: string
  transport: string
  command?: string
  args: string[]
  url?: string
  credentialSchema: Record<string, unknown>
  toolManifest?: Record<string, unknown>
  compatibility: string[]
  categories: string[]
  verified: boolean
}

const MCP_SERVERS: McpServerSeed[] = [
  {
    name: 'github',
    displayName: 'GitHub',
    description:
      'Repository management, issues, pull requests, code search, and file operations via the GitHub API.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-github',
    latestVersion: '2025.1.13',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    credentialSchema: {
      credentials: [
        {
          key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
          description: 'GitHub Personal Access Token with repo scope',
          required: true,
        },
      ],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline', 'roo'],
    categories: ['development', 'version-control'],
    verified: true,
  },
  {
    name: 'gitlab',
    displayName: 'GitLab',
    description:
      'GitLab API integration for project management, merge requests, issues, and CI/CD pipelines.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-gitlab',
    latestVersion: '2025.1.13',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    credentialSchema: {
      credentials: [
        {
          key: 'GITLAB_PERSONAL_ACCESS_TOKEN',
          description: 'GitLab Personal Access Token',
          required: true,
        },
        {
          key: 'GITLAB_API_URL',
          description: 'GitLab API URL (defaults to gitlab.com)',
          required: false,
        },
      ],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline'],
    categories: ['development', 'version-control'],
    verified: true,
  },
  {
    name: 'linear',
    displayName: 'Linear',
    description:
      'Linear project management — issues, projects, teams, cycles, and workflow management.',
    author: 'community',
    sourceType: 'npm',
    sourcePackage: '@anthropic/mcp-server-linear',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-linear'],
    credentialSchema: {
      credentials: [
        {
          key: 'LINEAR_API_KEY',
          description: 'Linear API key from Settings > API',
          required: true,
        },
      ],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline'],
    categories: ['project-management', 'productivity'],
    verified: true,
  },
  {
    name: 'slack',
    displayName: 'Slack',
    description:
      'Slack workspace integration — send messages, read channels, manage conversations.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-slack',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    credentialSchema: {
      credentials: [
        {
          key: 'SLACK_BOT_TOKEN',
          description: 'Slack Bot User OAuth Token (xoxb-...)',
          required: true,
        },
        {
          key: 'SLACK_TEAM_ID',
          description: 'Slack workspace team ID',
          required: true,
        },
      ],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot'],
    categories: ['communication', 'productivity'],
    verified: true,
  },
  {
    name: 'postgres',
    displayName: 'PostgreSQL',
    description:
      'Read-only PostgreSQL database access — query tables, inspect schema, analyse data.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-postgres',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    credentialSchema: {
      credentials: [
        {
          key: 'DATABASE_URL',
          description: 'PostgreSQL connection string (postgresql://...)',
          required: true,
        },
      ],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline'],
    categories: ['database', 'development'],
    verified: true,
  },
  {
    name: 'filesystem',
    displayName: 'Filesystem',
    description: 'Secure file system access with configurable allowed directories.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    credentialSchema: {
      credentials: [],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline', 'roo'],
    categories: ['development', 'utilities'],
    verified: true,
  },
  {
    name: 'brave-search',
    displayName: 'Brave Search',
    description: 'Web and local search via the Brave Search API.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-brave-search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    credentialSchema: {
      credentials: [
        {
          key: 'BRAVE_API_KEY',
          description: 'Brave Search API key',
          required: true,
        },
      ],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline'],
    categories: ['search', 'web'],
    verified: true,
  },
  {
    name: 'puppeteer',
    displayName: 'Puppeteer',
    description:
      'Browser automation — navigate pages, take screenshots, interact with web content.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-puppeteer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    credentialSchema: {
      credentials: [],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot'],
    categories: ['web', 'automation', 'testing'],
    verified: true,
  },
  {
    name: 'google-maps',
    displayName: 'Google Maps',
    description: 'Google Maps Platform APIs — geocoding, directions, places, and elevation.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-google-maps',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-maps'],
    credentialSchema: {
      credentials: [
        {
          key: 'GOOGLE_MAPS_API_KEY',
          description: 'Google Maps Platform API key',
          required: true,
        },
      ],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot'],
    categories: ['maps', 'apis'],
    verified: true,
  },
  {
    name: 'sentry',
    displayName: 'Sentry',
    description: 'Sentry error tracking — view issues, events, releases, and performance data.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-sentry',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sentry'],
    credentialSchema: {
      credentials: [
        {
          key: 'SENTRY_AUTH_TOKEN',
          description: 'Sentry authentication token',
          required: true,
        },
        {
          key: 'SENTRY_ORGANIZATION',
          description: 'Sentry organisation slug',
          required: true,
        },
      ],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot'],
    categories: ['monitoring', 'development'],
    verified: true,
  },
  {
    name: 'memory',
    displayName: 'Memory',
    description: 'Knowledge graph-based persistent memory for AI assistants.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    credentialSchema: {
      credentials: [],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline', 'roo'],
    categories: ['ai', 'utilities'],
    verified: true,
  },
  {
    name: 'fetch',
    displayName: 'Fetch',
    description: 'HTTP client for fetching URLs with content extraction and conversion.',
    author: 'Anthropic',
    sourceType: 'npm',
    sourcePackage: '@modelcontextprotocol/server-fetch',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    credentialSchema: {
      credentials: [],
    },
    compatibility: ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline', 'roo'],
    categories: ['web', 'utilities'],
    verified: true,
  },
]

async function seed() {
  for (const server of MCP_SERVERS) {
    const data = {
      ...server,
      credentialSchema: server.credentialSchema as object,
      toolManifest: (server.toolManifest ?? undefined) as object | undefined,
    }
    await prisma.mcpServerDefinition.upsert({
      where: { name: server.name },
      create: data,
      update: data,
    })
  }

  const count = await prisma.mcpServerDefinition.count()
  process.stdout.write(`Seeded ${count} MCP server definitions\n`)
}

seed()
  .catch((error) => {
    process.stderr.write(`Seed failed: ${error}\n`)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
