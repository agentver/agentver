import { Logger } from 'tslog'

export function createLogger(name: string, minLevel?: number): Logger<unknown> {
  return new Logger({
    name,
    minLevel: minLevel ?? (process.env.NODE_ENV === 'production' ? 3 : 0),
    prettyLogTemplate: '{{dateIsoStr}} {{logLevelName}} [{{name}}] ',
  })
}
