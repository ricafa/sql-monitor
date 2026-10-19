import type { SqlRun } from '../types'

/** Cores de tema, as mesmas que o Flightdeck usa; o painel acompanha o tema do Claude Code. */
export const STATUS_COLOR = { executando: 'warning', sucesso: 'success', falha: 'error' } as const
export const KIND_COLOR = { alteração: 'merged', consulta: 'suggestion' } as const
export const PANEL_COLOR = 'suggestion'
export const FAINT = 'subtle'
export const DIM = 'inactive'

export const STATUS_MARK = { executando: '●', sucesso: '✓', falha: '✗' } as const
export const KIND_MARK = { alteração: '◆', consulta: '◇' } as const

/** Medidor de largura fixa: `▰▰▰▱▱`. */
export function gauge(pct: number, width: number): { on: string; off: string } {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { on: '▰'.repeat(full), off: '▱'.repeat(width - full) }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Hora da execução; de outro dia, com a data na frente. */
export function clockOf(at: string, now: number): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const today = new Date(now)
  const isToday =
    date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
  return isToday ? time : `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time.slice(0, 5)}`
}

/** Há quanto tempo: `agora`, `45s`, `3m`, `2h`, `4d`. */
export function agoOf(at: string, now: number): string {
  const time = new Date(at).getTime()
  if (Number.isNaN(time)) return ''
  const s = Math.max(0, Math.round((now - time) / 1000))
  if (s < 10) return 'agora'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function summaryOf(list: readonly SqlRun[]) {
  const failures = list.filter(one => one.status === 'falha').length
  const successes = list.filter(one => one.status === 'sucesso').length
  const finished = failures + successes
  return {
    total: list.length,
    changes: list.filter(one => one.kind === 'alteração').length,
    failures,
    running: list.filter(one => one.status === 'executando').length,
    /** Percentual de sucesso entre as execuções que já terminaram; null enquanto nenhuma terminou. */
    successPct: finished === 0 ? null : (successes / finished) * 100,
  }
}
