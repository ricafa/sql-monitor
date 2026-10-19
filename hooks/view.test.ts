import { expect, test } from 'claude-code/testing'

import type { SqlRun } from '../types'
import { agoOf, clockOf, gauge, summaryOf } from './view'

const run = (status: SqlRun['status'], kind: SqlRun['kind'] = 'consulta'): SqlRun => ({
  id: `${Math.random()}`,
  at: '2026-10-19T12:00:00.000Z',
  tool: 'Bash',
  sql: 'SELECT 1 FROM DUAL',
  kind,
  status,
})

test('o medidor enche proporcionalmente e nunca passa da largura', () => {
  expect(gauge(0, 5)).toEqual({ on: '', off: '▱▱▱▱▱' })
  expect(gauge(60, 5)).toEqual({ on: '▰▰▰', off: '▱▱' })
  expect(gauge(100, 5)).toEqual({ on: '▰▰▰▰▰', off: '' })
  expect(gauge(250, 4).on).toBe('▰▰▰▰')
  expect(gauge(-10, 4).on).toBe('')
})

test('a hora mostra só o horário no mesmo dia e a data em outro dia', () => {
  const now = new Date(2026, 9, 19, 15, 0, 0).getTime()
  const sameDay = new Date(2026, 9, 19, 9, 5, 7).toISOString()
  const other = new Date(2026, 9, 17, 9, 5, 7).toISOString()
  expect(clockOf(sameDay, now)).toBe('09:05:07')
  expect(clockOf(other, now)).toBe('17/10 09:05')
  expect(clockOf('não é data', now)).toBe('não é data')
})

test('há quanto tempo, em unidades curtas', () => {
  const now = Date.parse('2026-10-19T12:10:00.000Z')
  const ago = (s: number) => agoOf(new Date(now - s * 1000).toISOString(), now)
  expect(ago(3)).toBe('agora')
  expect(ago(45)).toBe('45s')
  expect(ago(180)).toBe('3m')
  expect(ago(7300)).toBe('2h')
  expect(ago(4 * 86400)).toBe('4d')
  expect(agoOf('xx', now)).toBe('')
})

test('o resumo conta alterações, falhas e a taxa de sucesso das que terminaram', () => {
  const list = [run('sucesso'), run('sucesso', 'alteração'), run('sucesso'), run('falha'), run('executando')]
  expect(summaryOf(list)).toEqual({ total: 5, changes: 1, failures: 1, running: 1, successPct: 75 })
  expect(summaryOf([run('executando')]).successPct).toBeNull()
  expect(summaryOf([]).total).toBe(0)
})
