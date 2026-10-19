import { expect, test } from 'claude-code/testing'

import {
  blocksFromFields,
  blocksFromShell,
  effectIn,
  failureIn,
  kindOf,
  needsApproval,
  rowCounts,
  sqlFromFields,
  sqlFromShell,
} from './sql'

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


test('ignora a criação de procedure, inclusive os comandos do corpo', () => {
  const sql = sqlFromShell(`docker exec -i lqs-oracle sqlplus -s u/p@FREEPDB1 <<'SQL'
CREATE OR REPLACE PROCEDURE aumenta_sal(p_dept NUMBER) AS
  v_total NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM emp WHERE deptno = p_dept;
  UPDATE emp SET sal = sal + 1 WHERE deptno = p_dept;
  COMMIT;
END;
/
SELECT ename FROM emp WHERE deptno = 10;
SQL`)
  expect(sql).toEqual(['SELECT ename FROM emp WHERE deptno = 10'])
})

test('ignora trigger, view, sinônimo, blocos anônimos e a execução de procedures', () => {
  const run = (sql: string) => sqlFromShell(`sqlplus -s u/p@db <<'SQL'\n${sql}\nSQL`)
  expect(run('CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON emp FOR EACH ROW\nBEGIN\n  :new.sal := 0;\nEND;\n/')).toEqual([])
  expect(run('CREATE OR REPLACE FORCE VIEW v_emp AS SELECT ename FROM emp;')).toEqual([])
  expect(run('DROP VIEW v_emp;')).toEqual([])
  expect(run('DROP TRIGGER trg;')).toEqual([])
  expect(run('CREATE PUBLIC SYNONYM e FOR emp;')).toEqual([])
  expect(run('BEGIN aumenta_sal(20); END;\n/')).toEqual([])
  expect(run('EXEC aumenta_sal(20);')).toEqual([])
  expect(run('DECLARE\n  n NUMBER;\nBEGIN\n  UPDATE emp SET sal = 1;\nEND;\n/')).toEqual([])
})

test('ignora blocos de transação começados em BEGIN e mantém tabelas', () => {
  expect(sqlFromShell('psql -c "BEGIN; UPDATE emp SET sal = 1 WHERE empno = 1; COMMIT;"')).toEqual([])
  expect(sqlFromShell(`sqlplus -s u/p@db <<'SQL'
BEGIN
  UPDATE emp SET sal = 1;
END;
/
SELECT ename FROM emp;
SQL`)).toEqual([
    'SELECT ename FROM emp',
  ])
  expect(sqlFromShell(`sqlplus -s u/p@db <<'SQL'\nCREATE TABLE tmp (id NUMBER);\nSQL`)).toEqual(['CREATE TABLE tmp (id NUMBER)'])
})

test('conta as linhas afetadas pela saída de cada cliente', () => {
  expect(rowCounts(['UPDATE emp SET sal = 1'], '\n3 rows updated.\n\nCommit complete.')).toEqual([3])
  expect(rowCounts(['INSERT INTO t VALUES (1)'], '1 row created.')).toEqual([1])
  expect(rowCounts(['SELECT * FROM emp'], 'no rows selected')).toEqual([0])
  expect(rowCounts(['SELECT * FROM emp'], '...\n\n14 rows selected.')).toEqual([14])
  expect(rowCounts(['UPDATE emp SET sal = 1'], 'UPDATE 3')).toEqual([3])
  expect(rowCounts(['INSERT INTO t VALUES (1)'], 'INSERT 0 1')).toEqual([1])
  expect(rowCounts(['DELETE FROM t'], 'Query OK, 2 rows affected (0.01 sec)')).toEqual([2])
  expect(rowCounts(['DELETE FROM t'], '\n(4 rows affected)\n')).toEqual([4])
  expect(rowCounts(['SELECT 1 FROM t'], ' a\n---\n 1\n(1 row)\n')).toEqual([1])
})

test('deixa null quando não há certeza', () => {
  // SELECT de 5 linhas no sqlplus não imprime a contagem; o UPDATE ainda recebe a sua.
  expect(rowCounts(['SELECT * FROM emp', 'UPDATE emp SET sal = 1'], 'EMPNO\n----\n7369\n\n1 row updated.')).toEqual([
    null,
    1,
  ])
  // Dois SELECTs e uma contagem só: não dá para saber de qual é.
  expect(rowCounts(['SELECT * FROM a', 'SELECT * FROM b'], '12 rows selected.')).toEqual([null, null])
  expect(rowCounts(['CREATE TABLE t (id NUMBER)'], 'Table created.')).toEqual([null])
  expect(rowCounts(['UPDATE emp SET sal = 1', 'DELETE FROM t'], '2 rows updated.\n\n5 rows deleted.')).toEqual([2, 5])
})

test('pede autorização só para INSERT, UPDATE, DELETE e MERGE', () => {
  expect(needsApproval('INSERT INTO t VALUES (1)')).toBe(true)
  expect(needsApproval('update emp set sal = 1')).toBe(true)
  expect(needsApproval('DELETE FROM t')).toBe(true)
  expect(needsApproval('MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.a = s.a')).toBe(true)
  expect(needsApproval('WITH x AS (SELECT 1 FROM dual) INSERT INTO t SELECT * FROM x')).toBe(true)
  expect(needsApproval('SELECT * FROM emp')).toBe(false)
  expect(needsApproval('SELECT last_update, deleted FROM emp')).toBe(false)
  expect(needsApproval('WITH x AS (SELECT last_update FROM t) SELECT * FROM x')).toBe(false)
  expect(needsApproval('CREATE TABLE t (id NUMBER)')).toBe(false)
  expect(needsApproval('TRUNCATE TABLE t')).toBe(false)
})

test('acha os blocos PL/SQL que o monitor não lista', () => {
  expect(blocksFromShell("sqlplus -s u/p@db <<'SQL'\nBEGIN\n  UPDATE emp SET sal = 1;\nEND;\n/\nSQL")).toEqual([
    'BEGIN\n  UPDATE emp SET sal = 1;\nEND;',
  ])
  expect(blocksFromFields({ sql: 'CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;' })).toEqual([
    'CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;',
  ])
  expect(blocksFromFields({ sql: 'SELECT * FROM emp', query: 'UPDATE emp SET sal = 1' })).toEqual([])
  expect(blocksFromShell('git commit -m "begin: nova tela"')).toEqual([])
})
