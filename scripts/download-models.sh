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

# 下载函数
download_model() {
    local MODEL_PATH="$1"
    local MODEL_URL="$2"
    local MODEL_NAME="$3"

    if [ -f "$MODEL_PATH" ] && is_valid_onnx "$MODEL_PATH"; then
        SIZE=$(ls -lh "$MODEL_PATH" | awk '{print $5}')
        echo "✓ $MODEL_NAME exists ($SIZE)"
    else
        if [ -f "$MODEL_PATH" ]; then
            echo "Existing $MODEL_NAME is not a valid ONNX file; re-downloading..."
            rm -f "$MODEL_PATH"
        fi
        echo "Downloading $MODEL_NAME..."
        if command -v curl &> /dev/null; then
            curl -fL -o "$MODEL_PATH" "$MODEL_URL"
        elif command -v wget &> /dev/null; then
            wget -O "$MODEL_PATH" "$MODEL_URL"
        else
            echo "Error: curl or wget required"
            exit 1
        fi

        if [ -f "$MODEL_PATH" ] && is_valid_onnx "$MODEL_PATH"; then
            SIZE=$(ls -lh "$MODEL_PATH" | awk '{print $5}')
            echo "✓ Downloaded: $MODEL_NAME ($SIZE)"
        else
            echo "✗ Download failed or produced an invalid ONNX file: $MODEL_NAME"
            exit 1
        fi
    fi
}

is_valid_onnx() {
    local MODEL_PATH="$1"
    local SIZE
    SIZE=$(wc -c < "$MODEL_PATH" | tr -d ' ')
    if [ "$SIZE" -lt 1024 ]; then
        return 1
    fi
    if head -c 256 "$MODEL_PATH" | grep -qiE '<!doctype|<html|not found|version https://git-lfs.github.com/spec'; then
        return 1
    fi
    return 0
}

# ============ Silero VAD ============
# 官方仓库: https://github.com/snakers4/silero-vad
# 许可: MIT License
# 用途: 语音活动检测 (VAD)
download_model \
    "$MODELS_DIR/silero_vad.onnx" \
    "https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx" \
    "Silero VAD"

# ============ Smart Turn v3.2 ============
# 官方仓库: https://github.com/pipecat-ai/smart-turn
# HuggingFace: https://huggingface.co/pipecat-ai/smart-turn-v3
# 许可: BSD 2-Clause License
# 用途: 智能话音结束检测 (Endpointing)
download_model \
    "$MODELS_DIR/smart-turn-v3.2-cpu.onnx" \
    "https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx?download=true" \
    "Smart Turn v3.2"

echo ""
echo "All models ready in: $MODELS_DIR"
ls -lh "$MODELS_DIR"/*.onnx 2>/dev/null || true
