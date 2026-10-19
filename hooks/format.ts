export type PartKind = 'keyword' | 'function' | 'string' | 'number' | 'bind' | 'join' | 'comment' | 'plain'
export type Part = { text: string; kind: PartKind }
export type Line = { indent: number; parts: Part[] }

type Token = { text: string; key: string; kind: PartKind | undefined; space: boolean; isWord: boolean }

type Frame = {
  /** Abre uma subconsulta (quebra de linha nas cláusulas) ou só agrupa (função, lista do IN). */
  isBlock: boolean
  /** Coluna das cláusulas deste nível. */
  base: number
  /** Largura da cláusula atual mais um espaço, onde alinham os itens depois da vírgula. */
  clause: number
  /** Dentro de um BETWEEN, o próximo AND é do intervalo e não quebra a linha. */
  between: boolean
}

const KEYWORDS = new Set(
  (
    'SELECT FROM WHERE AND OR NOT IN EXISTS BETWEEN LIKE IS NULL AS ON JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL ' +
    'GROUP BY ORDER HAVING UNION ALL INTERSECT MINUS DISTINCT UNIQUE INSERT INTO VALUES UPDATE SET DELETE MERGE USING ' +
    'WHEN THEN ELSE END CASE MATCHED CREATE ALTER DROP TABLE VIEW INDEX SEQUENCE TRUNCATE GRANT REVOKE TO WITH CONNECT ' +
    'START PRIOR ASC DESC NULLS FIRST LAST FOR RETURNING OVER PARTITION ANY SOME FETCH ROWS ONLY OFFSET LIMIT COMMENT'
  ).split(' '),
)

// Palavras que, juntas, formam uma cláusula só. As mais longas primeiro.
const PHRASES = [
  ['ORDER', 'SIBLINGS', 'BY'],
  ['LEFT', 'OUTER', 'JOIN'],
  ['RIGHT', 'OUTER', 'JOIN'],
  ['FULL', 'OUTER', 'JOIN'],
  ['GROUP', 'BY'],
  ['ORDER', 'BY'],
  ['CONNECT', 'BY'],
  ['START', 'WITH'],
  ['UNION', 'ALL'],
  ['INSERT', 'INTO'],
  ['MERGE', 'INTO'],
  ['DELETE', 'FROM'],
  ['FOR', 'UPDATE'],
  ['INNER', 'JOIN'],
  ['LEFT', 'JOIN'],
  ['RIGHT', 'JOIN'],
  ['FULL', 'JOIN'],
  ['CROSS', 'JOIN'],
  ['NATURAL', 'JOIN'],
]

// Cláusulas que começam numa linha nova.
const CLAUSES = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'ORDER BY',
  'ORDER SIBLINGS BY',
  'HAVING',
  'UNION',
  'UNION ALL',
  'INTERSECT',
  'MINUS',
  'SET',
  'VALUES',
  'INSERT INTO',
  'UPDATE',
  'DELETE',
  'DELETE FROM',
  'MERGE INTO',
  'USING',
  'CONNECT BY',
  'START WITH',
  'WITH',
  'FOR UPDATE',
  'RETURNING',
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'LEFT OUTER JOIN',
  'RIGHT JOIN',
  'RIGHT OUTER JOIN',
  'FULL JOIN',
  'FULL OUTER JOIN',
  'CROSS JOIN',
  'NATURAL JOIN',
])

// Depois dessas palavras vem um nome de tabela, mesmo que grudado no `(` (`INSERT INTO t(a, b)`).
const NAME_AFTER = new Set(['INTO', 'FROM', 'UPDATE', 'JOIN', 'TABLE', 'INSERT INTO', 'DELETE FROM', 'MERGE INTO'])

const TOKEN =
  /(\s+)|(\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|("[^"]*"?)|(\(\+\))|([A-Za-z_][\w$#]*)|(\d+(?:\.\d+)?)|(:\w+)|([\s\S])/g

function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let space = false
  for (const m of sql.matchAll(TOKEN)) {
    if (m[1]) {
      space = true
      continue
    }
    const text = m[0]
    const kind: PartKind | undefined = m[2]
      ? 'comment'
      : m[3]
        ? 'string'
        : m[5]
          ? 'join'
          : m[7]
            ? 'number'
            : m[8]
              ? 'bind'
              : m[6]
                ? undefined
                : 'plain'
    tokens.push({ text, key: text.toUpperCase(), kind, space, isWord: Boolean(m[6]) })
    space = false
  }
  return tokens
}

function merge(tokens: Token[]): Token[] {
  const merged: Token[] = []
  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i]
    const phrase = first.isWord
      ? PHRASES.find(words => words.every((word, k) => tokens[i + k]?.isWord && tokens[i + k].key === word))
      : undefined
    if (!phrase) {
      merged.push(first)
      continue
    }
    const parts = tokens.slice(i, i + phrase.length)
    merged.push({ text: parts.map(one => one.text).join(' '), key: phrase.join(' '), kind: 'keyword', space: first.space, isWord: true })
    i += phrase.length - 1
  }
  return merged
}

function classify(tokens: Token[]): Token[] {
  return tokens.map((token, i) => {
    if (token.kind) return token
    if (KEYWORDS.has(token.key)) return { ...token, kind: 'keyword' }
    const next = tokens[i + 1]
    const isCall = next?.text === '(' && !next.space && !NAME_AFTER.has(tokens[i - 1]?.key ?? '')
    return { ...token, kind: isCall ? 'function' : 'plain' }
  })
}

/**
 * Quebra o SQL, que chega numa linha só, em linhas recuadas e com a cor de cada pedaço.
 *
 * Cada cláusula (SELECT, FROM, WHERE...) começa uma linha; depois da vírgula e antes de
 * AND/OR a linha quebra de novo; subconsultas entre parênteses ganham um nível de recuo.
 * Funções e listas entre parênteses ficam numa linha só.
 */
export function formatSql(sql: string): Line[] {
  const tokens = classify(merge(tokenize(sql)))
  const lines: Line[] = []
  let line: Line = { indent: 0, parts: [] }
  const stack: Frame[] = [{ isBlock: true, base: 0, clause: 0, between: false }]
  const top = () => stack[stack.length - 1]

  const newline = (indent: number) => {
    if (line.parts.length === 0) {
      line.indent = indent
      return
    }
    lines.push(line)
    line = { indent, parts: [] }
  }

  const push = (token: Token) => {
    const lead = line.parts.length > 0 && token.space ? ' ' : ''
    line.parts.push({ text: lead + token.text, kind: token.kind ?? 'plain' })
  }

  tokens.forEach((token, i) => {
    if (token.text === ')' && stack.length > 1) {
      const closing = stack.pop() as Frame
      if (closing.isBlock) newline(top().base)
      push(token)
      return
    }

    const frame = top()
    if (frame.isBlock) {
      if (CLAUSES.has(token.key)) {
        newline(frame.base)
        frame.clause = token.text.length + 1
      } else if (token.key === 'ON') {
        newline(frame.base + 2)
      } else if (token.key === 'AND' || token.key === 'OR') {
        if (token.key === 'AND' && frame.between) frame.between = false
        else newline(frame.base + 2)
      }
    }
    push(token)

    if (token.key === 'BETWEEN') frame.between = true
    if (token.text === ',' && frame.isBlock && frame.clause > 0) newline(frame.base + frame.clause)
    if (token.text === '(') {
      const next = tokens[i + 1]?.key
      const isBlock = next === 'SELECT' || next === 'WITH'
      stack.push({ isBlock, base: isBlock ? frame.base + 2 : frame.base, clause: 0, between: false })
    }
  })

  if (line.parts.length > 0) lines.push(line)
  return lines
}

/** O texto das linhas, sem cor, como o painel desenha. */
export function plainText(lines: readonly Line[]): string {
  return lines.map(one => ' '.repeat(one.indent) + one.parts.map(part => part.text).join('')).join('\n')
}
