import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const pane = (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile') => ({
  plugin: 'sql-monitor',
  component: 'Pane' as const,
  requestId: 'sql-monitor',
  surface,
  props: { title: 'SQL Monitor', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})

const sqlplus = (sql: string) => ({
  tool: 'Bash' as const,
  command: `docker exec lqs-oracle bash -c "echo '${sql};' | sqlplus -s LQS_USER/x@FREEPDB1"`,
  tool_use_id: `tu-${sql.length}`,
})

/** O motor sob o plugin: devolve a saída que o sqlplus daria. */
const engine = (on: On, output: string) => {
  on('tool.call', () => ({ result: { stdout: output, stderr: '', interrupted: false }, text: output }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.root', () => ({ value: 'C:/projeto' }))
  on('session.id', () => ({ value: 'sessao-teste' }))
  on('env.get', () => ({ value: 'C:/Users/teste' }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

test('sem execuções, o painel desenha o resumo e o aviso em todas as superfícies', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ text: /SQL Monitor/ })).toBeDefined()
    expect(await ui.find({ text: /ocioso/ })).toBeDefined()
    expect(await ui.find({ text: /Nenhum SQL executado/ })).toBeDefined()
    await ui.unmount()
  }
})

test('uma execução vira um cartão com status, tipo e resumo no topo', async ($, on) => {
  engine(on, '3 rows selected.')
  await $.tool.call(sqlplus('SELECT a.id, b.nome FROM tab_a a, tab_b b WHERE a.id = b.id(+)'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ text: /sucesso/ })).toBeDefined()
    expect(await ui.find({ text: /consulta/ })).toBeDefined()
    expect(await ui.find({ text: /execuções/ })).toBeDefined()
    expect(await ui.find({ text: /Nenhum SQL executado/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('enquanto a execução roda, o painel mostra o cartão como executando e o resultado o troca', async ($, on) => {
  let finish: () => void = () => {}
  const gate = new Promise<void>(resolve => (finish = resolve))
  on('tool.call', async () => {
    await gate
    return { result: { stdout: '1 row selected.', stderr: '', interrupted: false }, text: '1 row selected.' }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.root', () => ({ value: 'C:/projeto' }))
  on('session.id', () => ({ value: 'sessao-teste' }))
  on('env.get', () => ({ value: 'C:/Users/teste' }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  const call = $.tool.call(sqlplus('SELECT 1 FROM DUAL'))
  await new Promise(resolve => setTimeout(resolve, 25))
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(pane(surface))
    const seen = { surface, running: (await ui.find({ text: /executando/ })) !== undefined, idle: (await ui.find({ text: /ocioso/ })) !== undefined }
    expect(seen).toEqual({ surface, running: true, idle: false })
    await ui.unmount()
  }

  finish()
  await call
  const ui = await $.ui.mount(pane('terminal'))
  const after = { idle: (await ui.find({ text: /ocioso/ })) !== undefined, ok: (await ui.find({ text: /sucesso/ })) !== undefined }
  expect(after).toEqual({ idle: true, ok: true })
  await ui.unmount()
})
