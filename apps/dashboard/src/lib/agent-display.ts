export type AgentDisplayInfo = {
  label: string
  colour: string
}

export const AGENT_DISPLAY: Record<string, AgentDisplayInfo> = {
  'claude-code': { label: 'Claude Code', colour: 'bg-orange-100 text-orange-800' },
  'claude-cowork': { label: 'Claude Cowork', colour: 'bg-orange-100 text-orange-800' },
  cursor: { label: 'Cursor', colour: 'bg-cyan-100 text-cyan-800' },
  codex: { label: 'Codex', colour: 'bg-emerald-100 text-emerald-800' },
  opencode: { label: 'OpenCode', colour: 'bg-slate-100 text-slate-800' },
  copilot: { label: 'Copilot', colour: 'bg-indigo-100 text-indigo-800' },
  windsurf: { label: 'Windsurf', colour: 'bg-teal-100 text-teal-800' },
  gemini: { label: 'Gemini', colour: 'bg-blue-100 text-blue-800' },
  'roo-code': { label: 'Roo Code', colour: 'bg-violet-100 text-violet-800' },
  goose: { label: 'Goose', colour: 'bg-lime-100 text-lime-800' },
  junie: { label: 'Junie', colour: 'bg-fuchsia-100 text-fuchsia-800' },
  aider: { label: 'Aider', colour: 'bg-rose-100 text-rose-800' },
}
