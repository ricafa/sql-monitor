export type SqlKind = 'consulta' | 'alteração'

export type SqlRun = {
  id: string
  at: string
  tool: string
  sql: string
  kind: SqlKind
  status: 'executando' | 'sucesso' | 'falha'
  detail?: string
}

declare module 'claude-code' {
  interface PluginState {
    'sql-monitor': { runs: SqlRun[]; onlyChanges: boolean }
  }
}
