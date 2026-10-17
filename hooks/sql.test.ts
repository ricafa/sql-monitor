import { expect, test } from 'claude-code/testing'

import { effectIn, failureIn, kindOf, sqlFromFields, sqlFromShell } from './sql'

test('acha a consulta num sqlplus via docker', () => {
  const sql = sqlFromShell(
    'docker exec lqs-oracle bash -c "echo \'SELECT ename FROM emp WHERE deptno = 10;\' | sqlplus -s LQS_USER/x@FREEPDB1"',
  )
  expect(sql).toEqual(['SELECT ename FROM emp WHERE deptno = 10'])
  expect(kindOf(sql)).toBe('consulta')
})

test('acha o SQL depois de um \\n literal do printf', () => {
  const sql = sqlFromShell(
    `docker exec lqs-oracle bash -c 'printf "SET PAGESIZE 50\\nSELECT empno FROM emp WHERE deptno = 20;\\nEXIT\\n" | sqlplus -s "$U/$P@FREEPDB1"'`,
  )
  expect(sql).toEqual(['SELECT empno FROM emp WHERE deptno = 20'])
})

test('classifica alteração', () => {
  const sql = sqlFromShell("sqlplus -s u/p@db <<< \"UPDATE emp SET sal = sal * 1.1 WHERE deptno = 20; COMMIT;\"")
  expect(sql).toEqual(['UPDATE emp SET sal = sal * 1.1 WHERE deptno = 20'])
  expect(kindOf(sql)).toBe('alteração')
})

test('ignora comandos sem cliente de banco', () => {
  expect(sqlFromShell('git commit -m "update docs set up"')).toEqual([])
  expect(sqlFromShell('grep -rn "DELETE FROM emp" src')).toEqual([])
})

test('lê o SQL de uma ferramenta MCP', () => {
  expect(sqlFromFields({ tool: 'mcp__db__run', sql: 'DROP TABLE tmp' })).toEqual(['DROP TABLE tmp'])
})

test('acha o erro do Oracle e o efeito', () => {
  expect(failureIn('\nERROR at line 1:\nORA-00942: table or view does not exist')).toBe('ERROR at line 1:')
  expect(failureIn('3 rows updated.')).toBeUndefined()
  expect(effectIn('\n3 rows updated.\n\nCommit complete.')).toBe('3 rows updated')
})

