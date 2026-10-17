export type SqlKind = 'consulta' | 'alteração'

export type SqlRun = {
  id: string
  /** Data e hora em ISO 8601 (UTC). */
  at: string
  tool: string
  sql: string
  kind: SqlKind
  status: 'executando' | 'sucesso' | 'falha'
  detail?: string
  /** Linhas afetadas ou retornadas; null quando a saída não diz. */
  rows?: number | null
  project?: string
  session?: string
}

declare module 'claude-code' {
  interface PluginState {
    'sql-monitor': { runs: SqlRun[]; onlyChanges: boolean }
  }
}
