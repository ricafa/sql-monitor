import { expect, test } from 'claude-code/testing'

import { SPINNER, fmtElapsed, sweepAt } from './busy'

test('o cronômetro mostra décimos até um minuto e minutos depois', () => {
  expect(fmtElapsed(0)).toBe('0.0s')
  expect(fmtElapsed(2400)).toBe('2.4s')
  expect(fmtElapsed(59_900)).toBe('59.9s')
  expect(fmtElapsed(65_000)).toBe('1:05')
  expect(fmtElapsed(-5)).toBe('0.0s')
})

test('o bloco aceso vai e volta pela trilha sem sair dela', () => {
  const width = 12
  const seen = Array.from({ length: 40 }, (_, i) => sweepAt(i, width))
  expect(Math.min(...seen)).toBe(0)
  expect(Math.max(...seen)).toBe(width - 4)
  // Passos de uma célula: sem saltos.
  for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 1]!)).toBeLessThanOrEqual(1)
})

test('o spinner tem quadros distintos', () => {
  expect(new Set(SPINNER).size).toBe(SPINNER.length)
})
