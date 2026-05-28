#!/bin/bash

# Faz o bump de versão no package.json.
# Uso: bash scripts/bump-version.sh [patch|minor|major]
# Default: patch

set -e

LEVEL=${1:-patch}

if [[ "$LEVEL" != "patch" && "$LEVEL" != "minor" && "$LEVEL" != "major" ]]; then
  echo "ERROR: Argumento inválido '$LEVEL'. Use: patch, minor ou major."
  exit 1
fi

CURRENT_VERSION=$(node -pe "require('./package.json').version")

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$LEVEL" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"

# Atualiza o package.json sem usar npm version (evita criar tag)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Version bumped: $CURRENT_VERSION → $NEW_VERSION ($LEVEL)"
