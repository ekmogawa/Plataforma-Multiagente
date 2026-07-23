# workspace/

Diretório de runtime da plataforma. **O conteúdo não é versionado** (veja `.gitignore`).

- `projects/<slug>/` — cada software gerado pela plataforma vive aqui.
- `runs/<run-id>/` — por execução: logs, prompts enviados, respostas dos modelos,
  evidências de validação. Base para o modo replay (testes offline).
- `db/platform.db` — banco SQLite com estado dos runs, tarefas, métricas e cache.
