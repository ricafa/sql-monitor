import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SqlRun } from '../types'
import { CLEAR, RECENT, SCHEMA, fromJson, isoFrom, upsert } from './db'
import { effectIn, failureIn, kindOf, rowCounts, sqlFromFields, sqlFromShell } from './sql'

const PANE = 'sql-monitor'
const runs = atom({ plugin: 'sql-monitor', key: 'runs' } as const, [])
const onlyChanges = atom({ plugin: 'sql-monitor', key: 'onlyChanges' } as const, false)
const LIMIT = 200
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

function mark(run: SqlRun): string {
  return run.status === 'falha' ? '✗' : run.status === 'sucesso' ? '✓' : '…'
}

function lines(rows: number | null | undefined): string | undefined {
  if (rows === null || rows === undefined) return undefined
  return rows === 1 ? '1 linha' : `${rows} linhas`
}

function when(at: string): string {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString('pt-BR')
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
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, runs)
    const isFiltered = await read($, onlyChanges)
    const shown = isFiltered ? list.filter(one => one.kind === 'alteração') : list
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 3) / 4))
    const changes = list.filter(one => one.kind === 'alteração').length
    const failures = list.filter(one => one.status === 'falha').length

    return (
      <Box flexDirection="column">
        <Box>
          <Button
            key="todas"
            label={`Todas (${list.length})`}
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
          <Text dimColor> · {failures} falhas</Text>
        </Box>
        {shown.length === 0 && (
          <Text dimColor>
            {isFiltered ? 'Nenhuma alteração registrada.' : 'Nenhum SQL executado pela IA ainda.'}
          </Text>
        )}
        {shown
          .slice(-room)
          .reverse()
          .map(run => (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                <Text
                  bold
                  color={run.status === 'falha' ? 'red' : run.status === 'sucesso' ? 'green' : 'yellow'}
                >
                  {mark(run)} {run.status}
                </Text>
                <Text color={run.kind === 'alteração' ? 'magenta' : 'cyan'}> {run.kind}</Text>
                {lines(run.rows) && <Text bold> · {lines(run.rows)}</Text>}
                <Text dimColor>
                  {' '}
                  {when(run.at)} · {run.tool}
                </Text>
              </Text>
              <Text>{short(run.sql, 400)}</Text>
              {run.detail && <Text dimColor>{run.detail}</Text>}
            </Box>
          ))}
      </Box>
    )
  })
}
