import type { SqlKind } from '../types'

// Clientes e drivers que indicam que um comando de shell está mesmo rodando SQL,
// para não confundir com um `grep "DELETE FROM"` ou um `git commit -m "update"`.
const CLIENT =
  /\b(sqlplus|sqlcl|psql|mysql|mariadb|sqlite3|sqlcmd|invoke-sqlcmd|oracleconnection|oraclecommand|sqlconnection|duckdb|clickhouse-client)\b|\bsql\s+-|docker\s+(compose\s+)?exec\b/i

const STATEMENT =
  /\b(select\b[\s\S]+?\bfrom\b|with\s+\w+\s+as\s*\(|insert\s+into\b|update\s+[\w."$#]+\s+(?:\w+\s+)?set\b|delete\s+(?:from\s+)?[\w."$#]+|merge\s+into\b|(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:(?:no)?force\s+)?(?:(?:editionable|noneditionable)\s+)?(?:public\s+)?(?:global\s+temporary\s+)?(?:table|view|index|unique\s+index|sequence|synonym|procedure|function|package|trigger|type|user|schema|database|materialized\s+view)\b|truncate\s+table\b|rename\s+\w+\s+to\b|grant\b[\s\S]+?\bto\b|revoke\b[\s\S]+?\bfrom\b|comment\s+on\b)/i

const CHANGE = /^(insert|update|delete|merge|create|alter|drop|truncate|rename|grant|revoke|comment)\b/i

// Código PL/SQL (procedure, function, package, trigger, type e blocos anônimos) e qualquer
// bloco começado em BEGIN, inclusive o de transação (`BEGIN; ... COMMIT;`), não entram
// no monitor. O corpo vai até a `/` sozinha numa linha, como no sqlplus, e sai inteiro,
// para os comandos de dentro dele não aparecerem soltos.
const PLSQL =
  /\b(?:create\s+(?:or\s+replace\s+)?(?:(?:editionable|noneditionable)\s+)?(?:procedure|function|package(?:\s+body)?|trigger|type(?:\s+body)?)\b|declare\b|begin\b)[\s\S]*?(?:^[ \t]*\/[ \t]*$|(?![\s\S]))/gim

// Nem a criação, alteração ou remoção desses objetos, de views e de sinônimos.
const IGNORED =
  /^(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:(?:no)?force\s+)?(?:(?:editionable|noneditionable)\s+)?(?:public\s+)?(?:view|materialized\s+view|procedure|function|package|trigger|type|synonym)\b/i

// Erros que o cliente imprime mesmo saindo com código 0 (o sqlplus faz isso).
const FAILURE =
  /\b(ORA-\d{5}|PLS-\d{5}|SP2-\d{4}|ERROR at line \d+|ERROR \d{4} \(|Msg \d+, Level \d+|Error: near)|^\s*ERROR:/i

/** Tira do fim os `)` que fecham o shell (`$(...)`), e não o SQL, e as aspas antes deles. */
function unclosed(sql: string): string {
  let text = sql
  const count = (char: string) => text.split(char).length - 1
  while (text.endsWith(')') && count(')') > count('(')) {
    text = text.slice(0, -1).replace(/[\s"'`]+$/, '')
  }
  return text.trim()
}

/** Separa os comandos SQL de um texto, no `;` ou na `/` sozinha numa linha. */
export function statementsIn(text: string): string[] {
  const found: string[] = []
  // `\n` e `\t` escritos dentro de um printf/echo grudam na palavra seguinte ("\nSELECT").
  const plain = text.replace(/\\[nrt]/g, '\n').replace(PLSQL, '\n')
  for (const chunk of plain.split(/;|^\s*\/\s*$/m)) {
    const match = STATEMENT.exec(chunk)
    if (!match) continue
    const sql = unclosed(
      chunk
        .slice(match.index)
        .replace(/\s+/g, ' ')
        .replace(/[\s"'`]+$/, ''),
    )
    if (sql && !IGNORED.test(sql)) found.push(sql)
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
