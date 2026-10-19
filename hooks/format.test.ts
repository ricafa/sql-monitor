import { expect, test } from 'claude-code/testing'

import { formatBlock, formatSql, plainText } from './format'

const text = (sql: string) => plainText(formatSql(sql))

test('quebra as cláusulas e alinha os itens depois da vírgula', () => {
  expect(text('SELECT a.id, a.nome, b.valor FROM tab_a a, tab_b b WHERE a.id = b.id(+) AND a.ativo = 1 ORDER BY a.nome')).toBe(
    [
      'SELECT a.id,',
      '       a.nome,',
      '       b.valor',
      'FROM tab_a a,',
      '     tab_b b',
      'WHERE a.id = b.id(+)',
      '  AND a.ativo = 1',
      'ORDER BY a.nome',
    ].join('\n'),
  )
})

test('o AND do BETWEEN fica na mesma linha', () => {
  expect(text("SELECT 1 FROM dual WHERE d BETWEEN TO_DATE('01/01/2026', 'DD/MM/YYYY') AND SYSDATE AND x = 1")).toBe(
    [
      'SELECT 1',
      'FROM dual',
      "WHERE d BETWEEN TO_DATE('01/01/2026', 'DD/MM/YYYY') AND SYSDATE",
      '  AND x = 1',
    ].join('\n'),
  )
})

test('função e lista do IN ficam numa linha só', () => {
  expect(text("SELECT NVL(a, 0), COUNT(DISTINCT b) FROM t WHERE c IN (1, 2, 3)")).toBe(
    ['SELECT NVL(a, 0),', '       COUNT(DISTINCT b)', 'FROM t', 'WHERE c IN (1, 2, 3)'].join('\n'),
  )
})

test('subconsulta ganha um nível de recuo', () => {
  expect(text('SELECT * FROM emp WHERE deptno IN (SELECT deptno FROM dept WHERE loc = :loc) AND sal > 10')).toBe(
    [
      'SELECT *',
      'FROM emp',
      'WHERE deptno IN (',
      '  SELECT deptno',
      '  FROM dept',
      '  WHERE loc = :loc',
      ')',
      '  AND sal > 10',
    ].join('\n'),
  )
})

test('UPDATE e INSERT', () => {
  expect(text('UPDATE emp SET sal = sal * 1.1, comm = 0 WHERE deptno = 20')).toBe(
    ['UPDATE emp', 'SET sal = sal * 1.1,', '    comm = 0', 'WHERE deptno = 20'].join('\n'),
  )
  expect(text("INSERT INTO emp(id, nome) VALUES (1, 'it''s')")).toBe(
    ['INSERT INTO emp(id, nome)', "VALUES (1, 'it''s')"].join('\n'),
  )
})

test('o EXTRACT não quebra no FROM de dentro', () => {
  expect(text('SELECT EXTRACT(YEAR FROM dt) FROM t')).toBe(['SELECT EXTRACT(YEAR FROM dt)', 'FROM t'].join('\n'))
})

test('classifica os pedaços', () => {
  const kinds = formatSql("SELECT NVL(a, 1) FROM t WHERE b = 'x' AND c = :c AND d.e = f.g(+)")
    .flatMap(line => line.parts)
    .map(part => `${part.text.trim()}:${part.kind}`)
  expect(kinds).toContain('SELECT:keyword')
  expect(kinds).toContain('NVL:function')
  expect(kinds).toContain('1:number')
  expect(kinds).toContain("'x':string")
  expect(kinds).toContain(':c:bind')
  expect(kinds).toContain('(+):join')
  expect(kinds).toContain('t:plain')
})

test('não trava com SQL incompleto', () => {
  expect(text("SELECT 'aberta FROM t")).toBe("SELECT 'aberta FROM t")
  expect(text('SELECT ) FROM t')).toBe(['SELECT )', 'FROM t'].join('\n'))
})

const block = (text: string) => formatBlock(text)

test('bloco já em várias linhas só perde o recuo comum', () => {
  expect(block('    BEGIN\n      UPDATE emp SET sal = 1;\n    END;')).toBe('BEGIN\n  UPDATE emp SET sal = 1;\nEND;')
})

test('bloco corrido numa linha é quebrado e recuado', () => {
  expect(block("BEGIN UPDATE emp SET sal = 1 WHERE id = 2; IF SQL%ROWCOUNT = 0 THEN RAISE_APPLICATION_ERROR(-20001, 'x;y'); END IF; COMMIT; END;")).toBe(
    [
      'BEGIN',
      '  UPDATE emp',
      '  SET sal = 1',
      '  WHERE id = 2;',
      '  IF SQL%ROWCOUNT = 0 THEN',
      "    RAISE_APPLICATION_ERROR(-20001, 'x;y');",
      '  END IF;',
      '  COMMIT;',
      'END;',
    ].join('\n'),
  )
})

test('DECLARE, EXCEPTION e CASE dentro do bloco', () => {
  expect(block("DECLARE n NUMBER; BEGIN SELECT CASE WHEN a = 1 THEN 'x' ELSE 'y' END INTO n FROM t; EXCEPTION WHEN OTHERS THEN ROLLBACK; END;")).toBe(
    [
      'DECLARE',
      '  n NUMBER;',
      'BEGIN',
      "  SELECT CASE WHEN a = 1 THEN 'x' ELSE 'y' END INTO n",
      '  FROM t;',
      'EXCEPTION',
      '  WHEN OTHERS THEN',
      '  ROLLBACK;',
      'END;',
    ].join('\n'),
  )
})

test('BEGIN de transação não abre recuo', () => {
  expect(block('BEGIN; UPDATE emp SET sal = 1; COMMIT;')).toBe(['BEGIN;', 'UPDATE emp', 'SET sal = 1;', 'COMMIT;'].join('\n'))
})
