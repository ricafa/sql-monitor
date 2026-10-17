import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SqlRun } from '../types'
import { effectIn, failureIn, kindOf, sqlFromFields, sqlFromShell } from './sql'

const PANE = 'sql-monitor'
const runs = atom({ plugin: 'sql-monitor', key: 'runs' } as const, [])
const onlyChanges = atom({ plugin: 'sql-monitor', key: 'onlyChanges' } as const, false)
const STORED = 'runs'
const LIMIT = 200

/** Atualiza o histórico da sessão e grava a mesma lista no store, que sobrevive entre sessões. */
async function save($: EngineInterface, change: (list: SqlRun[]) => SqlRun[]): Promise<void> {
  await update($, runs, list => change([...list]).slice(-LIMIT))
  await $.store.set(STORED, await read($, runs))
}

/** Junta o que estava gravado com o que esta sessão já tem, sem repetir execuções. */
async function load($: EngineInterface): Promise<void> {
  const stored = await $.store.get(STORED)
  const saved = Array.isArray(stored) ? (stored as SqlRun[]) : []
  await save($, current => {
    const ids = new Set(current.map(one => one.id))
    const older = saved
      .filter(one => !ids.has(one.id))
      .map(one =>
        one.status === 'executando'
          ? { ...one, status: 'falha' as const, detail: 'sessão encerrada antes do fim da execução' }
          : one,
      )
    return [...older, ...current]
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
      await save($, () => [])
      return { text: 'Histórico do SQL Monitor zerado.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'SQL Monitor' })
    const total = (await read($, runs)).length
    return {
      text: opened.isPlaced
        ? `SQL Monitor aberto: ${total} execução(ões) registrada(s).`
        : `O SQL Monitor espera espaço no terminal: ${total} execução(ões) registrada(s).`,
    }
  })

  on('tool.call', async ($, e, next) => {
    const statements = sqlOf(e as unknown as Record<string, unknown>)
    if (statements.length === 0) return next(e)

    const run: SqlRun = {
      id: e.tool_use_id ?? `${Date.now()}`,
      at: new Date().toLocaleString('pt-BR'),
      tool: String(e.tool),
      sql: short(statements.join(';\n'), 4000),
      kind: kindOf(statements),
      status: 'executando',
    }
    await save($, list => [...list, run])

    const ran = await next(e)

    const output = ran.text ?? ''
    const error =
      ran.deny ?? (ran.isError ? short(output.trim() || 'erro na ferramenta', 160) : failureIn(output))
    const done: SqlRun = {
      ...run,
      status: error ? 'falha' : 'sucesso',
      detail: error ?? effectIn(output),
    }
    await save($, list => list.map(one => (one.id === run.id ? done : one)))

    const effect =
      done.kind === 'alteração' ? (error ? 'tentou alterar tabela' : 'alterou tabela') : 'só consulta'
    $.ui.toast(
      `${error ? '✗ falhou' : '✓ sucesso'} · ${effect}\n${short(run.sql, 300)}${done.detail ? `\n${done.detail}` : ''}`,
      { timeoutMs: error ? 8000 : 5000 },
    )

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
                <Text dimColor>
                  {' '}
                  {run.at} · {run.tool}
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
