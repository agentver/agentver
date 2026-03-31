export class ExitError extends Error {
  code: number

  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}
