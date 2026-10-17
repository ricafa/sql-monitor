# sql-monitor

Mod do Claude Code que registra o SQL que a IA executa.

- Depois de cada execução, mostra um toast com o SQL, se deu certo ou falhou, e se foi só consulta ou se alterou tabela.
- `/sql-monitor` abre um painel com o histórico, com filtro para ver só as alterações.
- `/sql-monitor limpar` apaga o histórico.

Detecta SQL em comandos de Bash e PowerShell que chamam um cliente de banco (`sqlplus`, `sqlcl`, `docker exec`, `psql`, `sqlcmd`, `sqlite3`...) e em ferramentas MCP com campos `sql`, `query` ou `statement`. Para saber se falhou, procura também `ORA-`, `PLS-`, `SP2-` e `ERROR at line` na saída, porque o `sqlplus` sai com código 0 mesmo com erro.

O histórico guarda as 200 execuções mais recentes e fica no store do plugin, em cada computador.

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
