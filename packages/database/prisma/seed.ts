import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../.env') })

// Lazy-import the client after env vars are loaded
const { prisma } = await import('../src/client')

const CATEGORIES = [
  {
    name: 'Development',
    slug: 'development',
    description: 'Coding standards, patterns, and best practices',
    icon: 'code',
    order: 1,
  },
  {
    name: 'Testing',
    slug: 'testing',
    description: 'Test writing, coverage, TDD, and quality assurance',
    icon: 'test-tube',
    order: 2,
  },
  {
    name: 'DevOps',
    slug: 'devops',
    description: 'CI/CD, infrastructure, and deployment',
    icon: 'server',
    order: 3,
  },
  {
    name: 'Documentation',
    slug: 'documentation',
    description: 'Doc writing, API docs, and technical writing',
    icon: 'file-text',
    order: 4,
  },
  {
    name: 'Security',
    slug: 'security',
    description: 'Vulnerability scanning, secure coding, and compliance',
    icon: 'shield',
    order: 5,
  },
  {
    name: 'Data',
    slug: 'data',
    description: 'Data engineering, analysis, and pipelines',
    icon: 'database',
    order: 6,
  },
  {
    name: 'Design',
    slug: 'design',
    description: 'Frontend, UI/UX, and accessibility',
    icon: 'palette',
    order: 7,
  },
  {
    name: 'Architecture',
    slug: 'architecture',
    description: 'System design, patterns, and review',
    icon: 'layers',
    order: 8,
  },
  {
    name: 'Workflow',
    slug: 'workflow',
    description: 'Productivity, automation, and tooling',
    icon: 'workflow',
    order: 9,
  },
  {
    name: 'Domain',
    slug: 'domain',
    description: 'Industry-specific skills, compliance, and regulation',
    icon: 'briefcase',
    order: 10,
  },
] as const

async function seed() {
  process.stdout.write('Seeding categories...\n')

  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        icon: category.icon,
        order: category.order,
      },
      create: {
        name: category.name,
        slug: category.slug,
        description: category.description,
        icon: category.icon,
        order: category.order,
      },
    })
  }

  process.stdout.write(`Seeded ${CATEGORIES.length} categories.\n`)
}

seed()
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
