// Animações de "processando", desenhadas no relógio de quadros da própria superfície: só esta região
// é redesenhada a cada passo, o painel não. O módulo de hooks só monta o Client enquanto há execução
// em andamento; ao terminar, o painel redesenha e o Client some.
import type { ClientModule } from 'claude-code'

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export const STEP_MS = 100
const HEAD = 4

type Props = {
  kind: 'spinner' | 'timer' | 'sweep'
  color: string
  dim: string
  /** Início da execução, em ms desde a época. */
  since: number
  /** Leitura do relógio do módulo de hooks no momento do desenho. */
  now: number
  /** Células da barra, para `sweep`. */
  width?: number
}

type Ref = { ticks: number; lastNow: number; base: number }
type State = { ref: Ref }

/** `2.4s` até um minuto, `1:05` depois. */
export const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, ms) / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** Posição do começo do bloco aceso: vai e volta pela trilha, sem pular nas pontas. */
export const sweepAt = (tick: number, width: number): number => {
  const span = Math.max(1, width - HEAD)
  const p = tick % (2 * span)
  return p <= span ? p : 2 * span - p
}

const Busy: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { ticks: 0, lastNow: -1, base: 0 }
  if (props.now !== ref.lastNow) {
    // Leitura nova do módulo de hooks: o cronômetro recomeça dela.
    ref.lastNow = props.now
    ref.base = props.now - props.since
    ref.ticks = 0
  }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      ref.ticks += 1
      surface.setState({ ref })
    })
  }

  if (props.kind === 'spinner') {
    return <Text color={props.color}>{SPINNER[ref.ticks % SPINNER.length]}</Text>
  }
  if (props.kind === 'timer') {
    return <Text color={props.color}>{fmtElapsed(ref.base + ref.ticks * STEP_MS)}</Text>
  }

  const width = Math.max(HEAD + 1, Math.min(props.width ?? 24, surface.columns || props.width || 24))
  const at = sweepAt(ref.ticks, width)
  return (
    <Box>
      <Text color={props.dim}>{'▱'.repeat(at)}</Text>
      <Text color={props.color} bold>
        {'▰'.repeat(HEAD)}
      </Text>
      <Text color={props.dim}>{'▱'.repeat(width - at - HEAD)}</Text>
    </Box>
  )
}

export default Busy
