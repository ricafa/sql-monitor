import type { SqlKind } from '../types'

// Clientes e drivers que indicam que um comando de shell está mesmo rodando SQL,
// para não confundir com um `grep "DELETE FROM"` ou um `git commit -m "update"`.
const CLIENT =
  /\b(sqlplus|sqlcl|psql|mysql|mariadb|sqlite3|sqlcmd|invoke-sqlcmd|oracleconnection|oraclecommand|sqlconnection|duckdb|clickhouse-client)\b|\bsql\s+-|docker\s+(compose\s+)?exec\b/i

const STATEMENT =
  /\b(select\b[\s\S]+?\bfrom\b|with\s+\w+\s+as\s*\(|insert\s+into\b|update\s+[\w."$#]+\s+(?:\w+\s+)?set\b|delete\s+(?:from\s+)?[\w."$#]+|merge\s+into\b|(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:global\s+temporary\s+)?(?:table|view|index|unique\s+index|sequence|synonym|procedure|function|package|trigger|type|user|schema|database|materialized\s+view)\b|truncate\s+table\b|rename\s+\w+\s+to\b|grant\b[\s\S]+?\bto\b|revoke\b[\s\S]+?\bfrom\b|comment\s+on\b|begin\b[\s\S]+?\bend\b)/i

const CHANGE =
  /^(insert|update|delete|merge|create|alter|drop|truncate|rename|grant|revoke|comment|begin)\b/i

// Erros que o cliente imprime mesmo saindo com código 0 (o sqlplus faz isso).
const FAILURE =
  /\b(ORA-\d{5}|PLS-\d{5}|SP2-\d{4}|ERROR at line \d+|ERROR \d{4} \(|Msg \d+, Level \d+|Error: near)|^\s*ERROR:/i

/** Separa os comandos SQL de um texto, no `;` ou na `/` sozinha numa linha. */
export function statementsIn(text: string): string[] {
  const found: string[] = []
  // `\n` e `\t` escritos dentro de um printf/echo grudam na palavra seguinte ("\nSELECT").
  const plain = text.replace(/\\[nrt]/g, '\n')
  for (const chunk of plain.split(/;|^\s*\/\s*$/m)) {
    const match = STATEMENT.exec(chunk)
    if (!match) continue
    const sql = chunk
      .slice(match.index)
      .replace(/\s+/g, ' ')
      .replace(/[\s"'`)]+$/, '')
      .trim()
    if (sql) found.push(sql)
  }
  return found
}

/** SQL de um comando de shell, só quando ele chama um cliente de banco. */
export function sqlFromShell(command: string): string[] {
  return CLIENT.test(command) ? statementsIn(command) : []
}

/** SQL dos campos de texto de uma ferramenta MCP (sql, query, statement...). */
export function sqlFromFields(input: Record<string, unknown>): string[] {
  const found: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || !/sql|query|statement/i.test(key)) continue
    found.push(...statementsIn(value))
  }
  return found
}

export function kindOf(statements: readonly string[]): SqlKind {
  return statements.some(sql => CHANGE.test(sql) || /^with\b[\s\S]*\b(insert|update|delete)\b/i.test(sql))
    ? 'alteração'
    : 'consulta'
}

/** A primeira linha de erro do banco na saída, se houver. */
export function failureIn(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .find(line => FAILURE.test(line))
    ?.trim()
}

/** Resumo do efeito, como "3 rows updated" ou "Table created.". */
export function effectIn(output: string): string | undefined {
  const match =
    /(\d+\s+rows?\s+(?:updated|inserted|deleted|merged|created|selected)|\d+\s+linhas?\s+\w+|no rows selected|\w+\s+(?:created|altered|dropped|truncated|renamed)\.|grant succeeded|revoke succeeded|PL\/SQL procedure successfully completed|Commit complete)/i.exec(
      output,
    )
  return match?.[1]
}
