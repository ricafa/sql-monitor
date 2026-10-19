# sql-monitor

Mod do Claude Code que registra o SQL que a IA executa.

- Depois de cada execução, mostra um toast com o SQL, se deu certo ou falhou, e se foi só consulta ou se alterou tabela.
- `/sql-monitor` abre um painel com o histórico, com filtro para ver só as alterações. O SQL aparece recuado, uma cláusula por linha (`SELECT`, `FROM`, `WHERE`, vírgulas e `AND`/`OR` quebram a linha, subconsultas ganham recuo) e colorido: palavras-chave em azul, funções em ciano, strings em verde, números e binds em amarelo, `(+)` em magenta. Cada execução mostra até 12 linhas. A formatação é só de exibição; o histórico e o toast guardam o SQL original.
- Antes de rodar um `INSERT`, `UPDATE`, `DELETE` ou `MERGE` (inclusive depois de um `WITH`), o mod trava a execução e pergunta ao usuário, mostrando o SQL formatado. Se ele negar, fechar a pergunta ou não houver ninguém para responder (`claude -p`), a ferramenta não roda e a IA recebe a negativa; o painel registra a falha. `SELECT`, DDL e o PL/SQL que o monitor ignora não pedem autorização. Se o próprio mod falhar antes de perguntar, o comando é bloqueado e não liberado.
- `/sql-monitor limpar` apaga o histórico.

Detecta SQL em comandos de Bash e PowerShell que chamam um cliente de banco (`sqlplus`, `sqlcl`, `docker exec`, `psql`, `sqlcmd`, `sqlite3`...) e em ferramentas MCP com campos `sql`, `query` ou `statement`. Código PL/SQL (procedures, functions, packages, triggers, types e qualquer bloco começado em `BEGIN`, inclusive o de transação), views e sinônimos não entram no monitor, nem a execução de procedures. Para saber se falhou, procura também `ORA-`, `PLS-`, `SP2-` e `ERROR at line` na saída, porque o `sqlplus` sai com código 0 mesmo com erro.

## Histórico em SQLite

Cada comando SQL vira uma linha da tabela `execucoes` em `~/.claude/sql-monitor/historico.db`, gravada quando a execução termina, já com o resultado. O banco é criado sozinho e guarda tudo; o painel mostra as 200 execuções mais recentes.

| coluna | conteúdo |
|---|---|
| `id` | id da chamada da ferramenta (com `:n` quando um comando tem vários SQL) |
| `executado_em` | data e hora em ISO 8601 (UTC) |
| `ferramenta` | `Bash`, `PowerShell` ou a ferramenta MCP |
| `sql` | o comando |
| `tipo` | `consulta` ou `alteração` |
| `status` | `sucesso` ou `falha` |
| `detalhe` | a linha do erro ou o efeito (`1 row updated`) |
| `linhas_afetadas` | linhas afetadas ou retornadas; `NULL` quando a saída não diz com certeza |
| `projeto` | pasta da sessão |
| `sessao` | id da sessão do Claude Code |

```
sqlite3 ~/.claude/sql-monitor/historico.db "SELECT executado_em, status, linhas_afetadas, sql FROM execucoes WHERE tipo = 'alteração'"
```

As linhas afetadas saem das mensagens do cliente (`3 rows updated.` no sqlplus, `UPDATE 3` no psql, `Query OK, 3 rows affected` no mysql, `(3 rows affected)` no sqlcmd). O sqlplus só escreve `N rows selected.` a partir de 6 linhas, então um SELECT menor fica com `NULL`.

Requer o `sqlite3` no PATH. Sem ele, o mod avisa uma vez e o histórico fica só na sessão. O banco é de cada computador; não o coloque numa pasta sincronizada (OneDrive, Dropbox), porque a sincronização pode corromper o SQLite.

`/sql-monitor limpar` apaga também o banco.

## Instalar

No terminal do Claude Code:

```
/plugin install sql-monitor --marketplace ricafa/sql-monitor
```

Responda `y` para adicionar o marketplace e escolha o escopo de usuário.

## Desenvolver

```
claude plugin validate .
claude plugin test .
```
