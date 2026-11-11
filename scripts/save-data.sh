#!/usr/bin/env bash
# Grava os dados no branch "data" (com tentativas, caso o painel tenha salvo algo ao mesmo tempo).
set -uo pipefail
cd data
git add -A
if git diff --cached --quiet; then echo "Sem mudanças nos dados."; exit 0; fi
git commit -q -m "dados: $(date -u +%Y-%m-%dT%H:%MZ)"
for i in 1 2 3 4 5; do
  if git push -q origin HEAD:data; then echo "Dados salvos."; exit 0; fi
  echo "Push recusado (tentativa $i); sincronizando..."
  git fetch -q origin data
  if ! git rebase -q origin/data; then
    # Conflito (raro): no rebase, "--ours" é a versão remota (painel) — mantém a lista de produtos do painel
    git checkout --ours products.json 2>/dev/null || true
    git add -A && GIT_EDITOR=true git rebase --continue || git rebase --abort
  fi
  sleep $((i * 2))
done
echo "Não consegui salvar os dados." >&2
exit 1
