import { expect, test } from 'claude-code/testing'

import { fromJson, isoFrom, quote, upsert } from './db'

test('escapa textos e trata NULL e números', () => {
  expect(quote("O'Brien")).toBe("'O''Brien'")
  expect(quote("'); DROP TABLE execucoes; --")).toBe("'''); DROP TABLE execucoes; --'")
  expect(quote(null)).toBe('NULL')
  expect(quote(undefined)).toBe('NULL')
  expect(quote(3)).toBe('3')
  expect(quote(Number.NaN)).toBe('NULL')
})

test('monta o insert com atualização na mesma id', () => {
  const sql = upsert([
    {
      id: 'toolu_1',
      at: '2026-10-17T09:00:00.000Z',
      tool: 'Bash',
      sql: "UPDATE emp SET ename = 'X' WHERE empno = 1",
      kind: 'alteração',
      status: 'sucesso',
      rows: 1,
      project: 'C:\projetos\lqs',
    },
  ])
  expect(sql).toContain("VALUES ('toolu_1', '2026-10-17T09:00:00.000Z', 'Bash', 'UPDATE emp SET ename = ''X'' WHERE empno = 1', 'alteração', 'sucesso', NULL, 1, 'C:\projetos\lqs', NULL)")
  expect(sql).toContain('ON CONFLICT (id) DO UPDATE')
})

test('lê a saída json do sqlite3', () => {
  expect(fromJson('')).toEqual([])
  const [run] = fromJson(
    '[{"id":"a","executado_em":"2026-10-17T09:00:00.000Z","ferramenta":"Bash","sql":"SELECT 1 FROM dual","tipo":"consulta","status":"sucesso","detalhe":null,"linhas_afetadas":null,"projeto":"C:/lqs","sessao":"s1"}]',
  )
  expect(run).toEqual({
    id: 'a',
    at: '2026-10-17T09:00:00.000Z',
    tool: 'Bash',
    sql: 'SELECT 1 FROM dual',
    kind: 'consulta',
    status: 'sucesso',
    detail: undefined,
    rows: null,
    project: 'C:/lqs',
    session: 's1',
  })
})

test('converte a data do histórico antigo', () => {
  const today = new Date(2026, 9, 17, 12, 0, 0)
  expect(isoFrom('17/10/2026, 06:12:17')).toBe(new Date(2026, 9, 17, 6, 12, 17).toISOString())
  expect(isoFrom('06:12:17', today)).toBe(new Date(2026, 9, 17, 6, 12, 17).toISOString())
})
