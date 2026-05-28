#!/bin/bash

# Verifica se houve bump de versão comparando com o commit anterior.
# Falha se a versão no package.json não tiver sido alterada.

set -e

PREVIOUS_VERSION=$(git show HEAD~1:package.json 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version" 2>/dev/null || echo "")
CURRENT_VERSION=$(node -pe "require('./package.json').version")

echo "Previous version: $PREVIOUS_VERSION"
echo "Current version: $CURRENT_VERSION"

if [ -z "$PREVIOUS_VERSION" ]; then
  echo "First commit or unable to read previous version. Proceeding."
  exit 0
fi

if [ "$PREVIOUS_VERSION" = "$CURRENT_VERSION" ]; then
  echo "ERROR: Version bump required! Current version ($CURRENT_VERSION) is the same as the previous commit."
  exit 1
fi

echo "Version bumped from $PREVIOUS_VERSION to $CURRENT_VERSION. OK."
