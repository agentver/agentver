import { isCloud } from '@agentver/shared'
import { router } from './init'
import { activityRouter } from './routers/activity'
import { adminRouter } from './routers/admin'
import { analyticsRouter } from './routers/analytics'
import { apiKeysRouter } from './routers/api-keys'
import { billingRouter } from './routers/billing'
import { bundlesRouter } from './routers/bundles'
import { categoriesRouter } from './routers/categories'
import { collectionsRouter } from './routers/collections'
import { connectionsRouter } from './routers/connections'
import { dashboardRouter } from './routers/dashboard'
import { exploreRouter } from './routers/explore'
import { forksRouter } from './routers/forks'
import { gitRouter } from './routers/git'
import { importsRouter } from './routers/imports'
import { maintainersRouter } from './routers/maintainers'
import { mcpCatalogueRouter } from './routers/mcp-catalogue'
import { notificationsRouter } from './routers/notifications'
import { organisationsRouter } from './routers/organisations'
import { proposalsRouter } from './routers/proposals'
import { searchRouter } from './routers/search'
import { skillsRouter } from './routers/skills'
import { starsRouter } from './routers/stars'
import { teamsRouter } from './routers/teams'
import { vaultRouter } from './routers/vault'
import { verificationRouter } from './routers/verification'
import { versionsRouter } from './routers/versions'
import { webhooksRouter } from './routers/webhooks'

export const appRouter = router({
  activity: activityRouter,
  analytics: analyticsRouter,
  bundles: bundlesRouter,
  categories: categoriesRouter,
  dashboard: dashboardRouter,
  explore: exploreRouter,
  forks: forksRouter,
  git: gitRouter,
  search: searchRouter,
  skills: skillsRouter,
  versions: versionsRouter,
  organisations: organisationsRouter,
  teams: teamsRouter,
  apiKeys: apiKeysRouter,
  collections: collectionsRouter,
  connections: connectionsRouter,
  imports: importsRouter,
  maintainers: maintainersRouter,
  mcpCatalogue: mcpCatalogueRouter,
  notifications: notificationsRouter,
  proposals: proposalsRouter,
  stars: starsRouter,
  vault: vaultRouter,
  verification: verificationRouter,
  webhooks: webhooksRouter,
  ...(isCloud() ? { admin: adminRouter, billing: billingRouter } : {}),
})

export type AppRouter = typeof appRouter
