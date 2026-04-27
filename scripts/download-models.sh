#!/bin/bash
# 下载模型文件
#
# 模型存放在项目根目录的 models/ 文件夹中

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
MODELS_DIR="$ROOT_DIR/models"

# 创建 models 目录
mkdir -p "$MODELS_DIR"

# ============ Silero VAD ============
# 官方仓库: https://github.com/snakers4/silero-vad
# 许可: MIT License

SILERO_MODEL="$MODELS_DIR/silero_vad.onnx"
SILERO_URL="https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx"

if [ -f "$SILERO_MODEL" ]; then
    echo "✓ Silero VAD model exists: $SILERO_MODEL"
else
    echo "Downloading Silero VAD model..."
    if command -v curl &> /dev/null; then
        curl -L -o "$SILERO_MODEL" "$SILERO_URL"
    elif command -v wget &> /dev/null; then
        wget -O "$SILERO_MODEL" "$SILERO_URL"
    else
        echo "Error: curl or wget required"
        exit 1
    fi

    if [ -f "$SILERO_MODEL" ]; then
        SIZE=$(ls -lh "$SILERO_MODEL" | awk '{print $5}')
        echo "✓ Downloaded: $SILERO_MODEL ($SIZE)"
    else
        echo "✗ Download failed"
        exit 1
    fi
fi

echo ""
echo "All models ready in: $MODELS_DIR"
