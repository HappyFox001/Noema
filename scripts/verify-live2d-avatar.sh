#!/usr/bin/env bash
set -euo pipefail

score=0

test -f plugins/live2d-avatar/plugin.json && score=$((score + 1))
test -f plugins/live2d-avatar/index.mjs && score=$((score + 1))
test -f plugins/live2d-avatar/assets/ui/index.html && score=$((score + 1))
test -f plugins/live2d-avatar/assets/ui/live2d-avatar.js && score=$((score + 1))
grep -q '"slot": "main-view"' plugins/live2d-avatar/plugin.json && score=$((score + 1))
grep -q 'ParamMouthOpenY' plugins/live2d-avatar/assets/ui/live2d-avatar.js && score=$((score + 1))
grep -q 'her-text:ui-state' plugins/live2d-avatar/assets/ui/live2d-avatar.js && score=$((score + 1))
grep -q 'config: Record<string, unknown>' apps/desktop/src/main/plugin-loader.ts && score=$((score + 1))
grep -q 'pluginConfig' apps/desktop/src/renderer/main.ts && score=$((score + 1))

echo "$score"
