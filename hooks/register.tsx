import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SqlRun } from '../types'
import { CLEAR, RECENT, SCHEMA, fromJson, isoFrom, upsert } from './db'
import { formatSql } from './format'
import type { Line, PartKind } from './format'
import { effectIn, failureIn, kindOf, rowCounts, sqlFromFields, sqlFromShell } from './sql'
import {
  DIM,
  FAINT,
  KIND_COLOR,
  KIND_MARK,
  PANEL_COLOR,
  STATUS_COLOR,
  STATUS_MARK,
  agoOf,
  clockOf,
  gauge,
  summaryOf,
} from './view'

const PANE = 'sql-monitor'
const runs = atom({ plugin: 'sql-monitor', key: 'runs' } as const, [])
const onlyChanges = atom({ plugin: 'sql-monitor', key: 'onlyChanges' } as const, false)
const LIMIT = 200
/** Linhas do SQL mostradas por execução; o resto vira "… +N linhas". */
const SQL_LINES = 12
const COLOR: Record<PartKind, 'blueBright' | 'cyan' | 'green' | 'yellow' | 'magenta' | undefined> = {
  keyword: 'blueBright',
  function: 'cyan',
  string: 'green',
  number: 'yellow',
  bind: 'yellow',
  join: 'magenta',
  comment: undefined,
  plain: undefined,
}
/** Chave do histórico antigo, de antes do SQLite; migrado e apagado na primeira sessão. */
const STORED = 'runs'

const README = `Histórico do mod sql-monitor do Claude Code.

historico.db é um banco SQLite com a tabela execucoes: uma linha por comando SQL
executado pela IA. Exemplo:

  sqlite3 historico.db "SELECT executado_em, status, linhas_afetadas, sql FROM execucoes WHERE tipo = 'alteração'"
`

let isWarned = false

async function folder($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home.replace(/\\/g, '/')}/.claude/sql-monitor`
}

/** Roda um script no historico.db pelo sqlite3, com a tabela criada se ainda não existir. */
async function sqlite($: EngineInterface, script: string, isJson = false): Promise<string> {
  const dir = await folder($)
  if (!(await $.fs.exists(`${dir}/LEIA-ME.txt`))) await $.fs.write(`${dir}/LEIA-ME.txt`, README)
  const argv = ['sqlite3', '-bail', '-cmd', '.timeout 5000', ...(isJson ? ['-json'] : []), `${dir}/historico.db`]
  const done = await $.process.run(argv, { stdin: SCHEMA + script, timeoutMs: 15000 })
  if (done.exitCode !== 0) throw new Error(done.stderr.trim() || `sqlite3 saiu com código ${done.exitCode}`)
  return done.stdout
}

/** Avisa uma vez por sessão que o SQLite falhou; o painel segue só com a memória da sessão. */
async function tryDb<T>($: EngineInterface, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch (error) {
    if (!isWarned) {
      isWarned = true
      const reason = error instanceof Error ? error.message : String(error)
      $.ui.toast(`Não consegui gravar no SQLite (${short(reason, 200)}). O histórico fica só nesta sessão.`, {
        timeoutMs: 10000,
      })
    }
    return undefined
  }
}

/** Leva o histórico do store (versões até 0.2.x) para o SQLite e apaga o store. */
async function migrate($: EngineInterface): Promise<void> {
  const stored = await $.store.get(STORED)
  if (!Array.isArray(stored) || stored.length === 0) return
  const old = (stored as SqlRun[]).map(run => ({
    ...run,
    at: isoFrom(run.at),
    status: run.status === 'executando' ? ('falha' as const) : run.status,
    detail: run.status === 'executando' ? 'sessão encerrada antes do fim da execução' : run.detail,
  }))
  if ((await tryDb($, () => sqlite($, upsert(old)))) !== undefined) await $.store.delete(STORED)
}

async function load($: EngineInterface): Promise<void> {
  await migrate($)
  const saved = await tryDb($, async () => fromJson(await sqlite($, RECENT, true)))
  if (!saved) return
  await update($, runs, current => {
    const ids = new Set(saved.map(one => one.id))
    return [...saved, ...current.filter(one => !ids.has(one.id))].slice(-LIMIT)
  })
}

function sqlOf(input: Record<string, unknown>): string[] {
  const tool = String(input.tool)
  if (tool === 'Bash' || tool === 'PowerShell') {
    return typeof input.command === 'string' ? sqlFromShell(input.command) : []
  }
  return tool.startsWith('mcp__') ? sqlFromFields(input) : []
}

function short(text: string, size: number): string {
  return text.length > size ? `${text.slice(0, size - 1)}…` : text
}

function lines(rows: number | null | undefined): string | undefined {
  if (rows === null || rows === undefined) return undefined
  return rows === 1 ? '1 linha' : `${rows} linhas`
}

function sqlLines(sql: string): { lines: Line[]; hidden: number } {
  const all = formatSql(sql)
  return { lines: all.slice(0, SQL_LINES), hidden: Math.max(0, all.length - SQL_LINES) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sql-monitor',
      description: 'Mostra o SQL executado pela IA (use "limpar" para apagar o histórico)',
    })
    await load($)
    return next(e)
  })

  on('command.run', { command: 'sql-monitor' }, async ($, e) => {
    if (/^\s*(limpar|clear)\s*$/i.test(e.args)) {
      await update($, runs, () => [])
      await tryDb($, () => sqlite($, CLEAR))
      return { text: 'Histórico do SQL Monitor apagado.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'SQL Monitor' })
    const total = (await read($, runs)).length
    return {
      text: opened.isPlaced
        ? `SQL Monitor aberto: ${total} execução(ões) recentes.`
        : `O SQL Monitor espera espaço no terminal: ${total} execução(ões) recentes.`,
    }
  })

  on('tool.call', async ($, e, next) => {
    const statements = sqlOf(e as unknown as Record<string, unknown>)
    if (statements.length === 0) return next(e)

    const base = e.tool_use_id ?? `${Date.now()}`
    const at = new Date().toISOString()
    const pending: SqlRun[] = statements.map((sql, index) => ({
      id: statements.length === 1 ? base : `${base}:${index + 1}`,
      at,
      tool: String(e.tool),
      sql: short(sql, 4000),
      kind: kindOf([sql]),
      status: 'executando',
    }))
    await update($, runs, list => [...list, ...pending].slice(-LIMIT))

    const ran = await next(e)

    const output = ran.text ?? ''
    const error =
      ran.deny ?? (ran.isError ? short(output.trim() || 'erro na ferramenta', 160) : failureIn(output))
    const counts = error ? statements.map(() => null) : rowCounts(statements, output)
    const project = await $.session.root()
    const session = await $.session.id()
    const done: SqlRun[] = pending.map((run, index) => ({
      ...run,
      status: error ? 'falha' : 'sucesso',
      detail: error ?? (statements.length === 1 ? effectIn(output) : undefined),
      rows: counts[index],
      project,
      session,
    }))
    await update($, runs, list => list.map(one => done.find(run => run.id === one.id) ?? one))
    await tryDb($, () => sqlite($, upsert(done)))

    const changes = done.some(run => run.kind === 'alteração')
    const effect = changes ? (error ? 'tentou alterar tabela' : 'alterou tabela') : 'só consulta'
    const body = done
      .map(run => `${short(run.sql, 200)}${lines(run.rows) ? ` → ${lines(run.rows)}` : ''}`)
      .join('\n')
    $.ui.toast(`${error ? '✗ falhou' : '✓ sucesso'} · ${effect}\n${short(body, 600)}${error ? `\n${error}` : ''}`, {
      timeoutMs: error ? 8000 : 5000,
    })

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // Superfícies sem Client (vscode, mobile) ficam com o símbolo parado.
    const hasClient = 'Client' in els
    const list = await read($, runs)
    const isFiltered = await read($, onlyChanges)
    const shown = isFiltered ? list.filter(one => one.kind === 'alteração') : list
    const now = Date.now()
    const { total, changes, failures, running, successPct } = summaryOf(list)
    const rate = successPct === null ? null : gauge(successPct, 8)
    const busy = (key: string, kind: 'spinner' | 'timer' | 'sweep', since: number, width: number, color: string) => (
      <els.Client key={key} module="./busy.tsx" width={width} height={1} props={{ kind, color, dim: FAINT, since, now, width }} />
    )

    // Do mais novo para o mais antigo, enquanto couber: cada execução é um cartão com borda
    // (2 linhas), cabeçalho, as linhas do SQL e, se houver, o resultado. O painel de resumo
    // ocupa 5 linhas.
    let free = (e.viewport?.rows ?? 24) - 6
    const visible: { run: SqlRun; lines: Line[]; hidden: number }[] = []
    for (const run of [...shown].reverse()) {
      const sql = sqlLines(run.sql)
      const height = 3 + sql.lines.length + (sql.hidden > 0 ? 1 : 0) + (run.detail || run.status === 'executando' ? 1 : 0)
      if (visible.length > 0 && height > free) break
      free -= height
      visible.push({ run, ...sql })
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={PANEL_COLOR} paddingX={1}>
          <Box justifyContent="space-between">
            <Text color={PANEL_COLOR} bold>
              SQL Monitor
            </Text>
            {running > 0 ? (
              <Box>
                {hasClient ? busy('spin-top', 'spinner', now, 1, 'warning') : <Text color="warning">●</Text>}
                <Text color="warning">{` executando ${running}`}</Text>
              </Box>
            ) : (
              <Text color={DIM}>○ ocioso</Text>
            )}
          </Box>
          <Text wrap="truncate">
            <Text dimColor>execuções </Text>
            <Text bold>{total}</Text>
            <Text color={KIND_COLOR['alteração']}>{`   ${KIND_MARK['alteração']} ${changes}`}</Text>
            <Text dimColor> alterações</Text>
            <Text color={failures > 0 ? 'error' : DIM}>{`   ✗ ${failures}`}</Text>
            <Text dimColor> falhas</Text>
            {rate && successPct !== null ? (
              <Text>
                <Text dimColor>{'   ok '}</Text>
                <Text color={successPct < 80 ? 'error' : 'success'}>{rate.on}</Text>
                <Text color={FAINT}>{rate.off}</Text>
                <Text bold>{` ${Math.round(successPct)}%`}</Text>
              </Text>
            ) : null}
          </Text>
          <Box>
            <Button
              key="todas"
              label={`Todas (${total})`}
              hotkey="t"
              variant={isFiltered ? 'secondary' : 'primary'}
              onPress={() => update($, onlyChanges, () => false)}
            />
            <Text> </Text>
            <Button
              key="alteracoes"
              label={`Alterações (${changes})`}
              hotkey="a"
              variant={isFiltered ? 'primary' : 'secondary'}
              onPress={() => update($, onlyChanges, () => true)}
            />
          </Box>
        </Box>
        {shown.length === 0 && (
          <Box borderStyle="round" borderColor={FAINT} paddingX={1}>
            <Text color={FAINT}>{isFiltered ? 'Nenhuma alteração registrada.' : 'Nenhum SQL executado pela IA ainda.'}</Text>
          </Box>
        )}
        {visible.map(({ run, lines: sql, hidden }) => {
          const color = STATUS_COLOR[run.status]
          const isRunning = run.status === 'executando'
          const since = Date.parse(run.at) || now
          return (
            <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
              <Box justifyContent="space-between">
                <Box>
                  {isRunning && hasClient ? (
                    busy(`spin-${run.id}`, 'spinner', since, 1, color)
                  ) : (
                    <Text bold color={color}>
                      {STATUS_MARK[run.status]}
                    </Text>
                  )}
                  <Text wrap="truncate">
                    <Text bold color={color}>
                      {` ${run.status}`}
                    </Text>
                    <Text bold color={KIND_COLOR[run.kind]}>
                      {`  ${KIND_MARK[run.kind]} ${run.kind}`}
                    </Text>
                    <Text dimColor>{`  ${run.tool}`}</Text>
                  </Text>
                </Box>
                <Box>
                  {isRunning && hasClient ? busy(`time-${run.id}`, 'timer', since, 6, color) : null}
                  <Text wrap="truncate">
                    {lines(run.rows) && <Text bold>{`${lines(run.rows)}  `}</Text>}
                    <Text color={FAINT}>{`${isRunning && hasClient ? '  ' : ''}${clockOf(run.at, now)}`}</Text>
                    <Text dimColor>{` · ${agoOf(run.at, now)}`}</Text>
                  </Text>
                </Box>
              </Box>
              {sql.map(one => (
                <Text>
                  {' '.repeat(one.indent)}
                  {one.parts.map(part => (
                    <Text color={COLOR[part.kind]} dimColor={part.kind === 'comment'}>
                      {part.text}
                    </Text>
                  ))}
                </Text>
              ))}
              {hidden > 0 && <Text color={FAINT}>… +{hidden} linhas</Text>}
              {isRunning && hasClient ? busy(`sweep-${run.id}`, 'sweep', since, 24, color) : null}
              {run.detail &&
                (run.status === 'falha' ? (
                  <Text color="error" wrap="truncate">{`✗ ${run.detail}`}</Text>
                ) : (
                  <Text dimColor wrap="truncate">{`› ${run.detail}`}</Text>
                ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
