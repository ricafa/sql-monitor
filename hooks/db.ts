import type { SqlRun } from '../types'

export const SCHEMA = `CREATE TABLE IF NOT EXISTS execucoes (
  id TEXT PRIMARY KEY,
  executado_em TEXT NOT NULL,
  ferramenta TEXT NOT NULL,
  sql TEXT NOT NULL,
  tipo TEXT NOT NULL,
  status TEXT NOT NULL,
  detalhe TEXT,
  linhas_afetadas INTEGER,
  projeto TEXT,
  sessao TEXT
);
CREATE INDEX IF NOT EXISTS execucoes_executado_em ON execucoes (executado_em);
`

export const RECENT = `SELECT id, executado_em, ferramenta, sql, tipo, status, detalhe, linhas_afetadas, projeto, sessao
FROM (SELECT rowid AS ordem, * FROM execucoes ORDER BY executado_em DESC, ordem DESC LIMIT 200)
ORDER BY executado_em, ordem;
`

export const CLEAR = 'DELETE FROM execucoes;\n'

/** Literal SQL: texto entre aspas simples (as de dentro dobradas), inteiro ou NULL. */
export function quote(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.trunc(value)) : 'NULL'
  return `'${value.replace(/\u0000/g, '').replace(/'/g, "''")}'`
}

/** Grava as execuções; a mesma id gravada de novo atualiza a linha. */
export function upsert(runs: readonly SqlRun[]): string {
  return runs
    .map(
      run =>
        `INSERT INTO execucoes (id, executado_em, ferramenta, sql, tipo, status, detalhe, linhas_afetadas, projeto, sessao)
VALUES (${[run.id, run.at, run.tool, run.sql, run.kind, run.status, run.detail, run.rows, run.project, run.session]
          .map(quote)
          .join(', ')})
ON CONFLICT (id) DO UPDATE SET status = excluded.status, detalhe = excluded.detalhe, linhas_afetadas = excluded.linhas_afetadas;
`,
    )
    .join('')
}

type Row = Record<string, string | number | null>

/** Lê a saída `-json` do sqlite3, que vem vazia quando não há linhas. */
export function fromJson(output: string): SqlRun[] {
  const rows: Row[] = output.trim() ? JSON.parse(output) : []
  return rows.map(row => ({
    id: String(row.id),
    at: String(row.executado_em),
    tool: String(row.ferramenta),
    sql: String(row.sql),
    kind: row.tipo === 'alteração' ? 'alteração' : 'consulta',
    status: row.status === 'falha' ? 'falha' : row.status === 'executando' ? 'executando' : 'sucesso',
    detail: row.detalhe === null ? undefined : String(row.detalhe),
    rows: typeof row.linhas_afetadas === 'number' ? row.linhas_afetadas : null,
    project: row.projeto === null ? undefined : String(row.projeto),
    session: row.sessao === null ? undefined : String(row.sessao),
  }))
}

/** Data das execuções gravadas no store antes do SQLite: "17/10/2026, 06:12:17" ou só "06:12:17". */
export function isoFrom(at: string, today: Date = new Date()): string {
  const full = /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/.exec(at)
  if (full) {
    const [day = 1, month = 1, year = 1970, hour = 0, minute = 0, second = 0] = full.slice(1).map(Number)
    return new Date(year, month - 1, day, hour, minute, second).toISOString()
  }
  const time = /^(\d{2}):(\d{2}):(\d{2})$/.exec(at)
  if (time) {
    const date = new Date(today)
    date.setHours(Number(time[1]), Number(time[2]), Number(time[3]), 0)
    return date.toISOString()
  }
  return Number.isNaN(Date.parse(at)) ? today.toISOString() : at
}
