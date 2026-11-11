#!/usr/bin/env bash
# Prepara a pasta ./data com o branch "data" (onde ficam produtos, preços e histórico).
set -euo pipefail
git config --global user.name "github-actions[bot]"
git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
if git ls-remote --exit-code --heads origin data >/dev/null 2>&1; then
  git fetch --depth=50 origin data:refs/remotes/origin/data
  git worktree add -B data data origin/data
else
  echo "Branch data não existe: criando."
  git worktree add --orphan -b data data
  mkdir -p data/history
  echo '[]' > data/products.json
  printf '# Dados do Verificador de Preços\n\nBranch mantido automaticamente pelo GitHub Actions. O painel edita `products.json`; o monitor grava `state.json` e `history/`.\n' > data/README.md
  touch data/history/.gitkeep
fi
ls -la data
