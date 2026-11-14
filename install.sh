#!/bin/bash
# ============================================================
# Doom's Enhancement Suite 汉化补丁 — 一键安装脚本
# 用法: bash install.sh [插件目录路径]
# 如果不传参数，会尝试自动检测常见路径
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  DES 汉化补丁安装器 v1.0                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# 确定插件目录
if [ -n "$1" ]; then
    PLUGIN_DIR="$1"
else
    # 尝试自动检测
    CANDIDATES=(
        "./SillyTavern/public/scripts/extensions/Dooms-Enhancement-Suite"
        "../SillyTavern/public/scripts/extensions/Dooms-Enhancement-Suite"
        "/data/SillyTavern/public/scripts/extensions/Dooms-Enhancement-Suite"
        "$HOME/SillyTavern/public/scripts/extensions/Dooms-Enhancement-Suite"
    )
    PLUGIN_DIR=""
    for dir in "${CANDIDATES[@]}"; do
        if [ -f "$dir/manifest.json" ]; then
            PLUGIN_DIR="$dir"
            break
        fi
    done
fi

if [ -z "$PLUGIN_DIR" ] || [ ! -f "$PLUGIN_DIR/manifest.json" ]; then
    echo -e "${RED}✗ 未找到 DES 插件目录${NC}"
    echo ""
    echo "请手动指定路径："
    echo "  bash install.sh /path/to/Dooms-Enhancement-Suite"
    echo ""
    echo "常见路径："
    echo "  SillyTavern/public/scripts/extensions/Dooms-Enhancement-Suite"
    echo "  SillyTavern/data/<用户名>/extensions/Dooms-Enhancement-Suite"
    exit 1
fi

echo -e "${GREEN}✓ 找到插件目录: $PLUGIN_DIR${NC}"

# 备份 manifest.json
cp "$PLUGIN_DIR/manifest.json" "$PLUGIN_DIR/manifest.json.bak"
echo -e "${GREEN}✓ 已备份 manifest.json → manifest.json.bak${NC}"

# 复制 locales 目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$PLUGIN_DIR/locales"
cp "$SCRIPT_DIR/locales/zh-CN.json" "$PLUGIN_DIR/locales/zh-CN.json"
echo -e "${GREEN}✓ 已复制 locales/zh-CN.json${NC}"

# 复制补丁 JS
cp "$SCRIPT_DIR/zh-CN-patch.js" "$PLUGIN_DIR/zh-CN-patch.js"
echo -e "${GREEN}✓ 已复制 zh-CN-patch.js${NC}"

# 修改 manifest.json（用 Node.js 保证 JSON 合法性）
if command -v node &> /dev/null; then
    node -e "
        const fs = require('fs');
        const m = JSON.parse(fs.readFileSync('$PLUGIN_DIR/manifest.json', 'utf8'));
        
        // 处理 js 字段
        if (typeof m.js === 'string') {
            m.js = ['zh-CN-patch.js', m.js];
        } else if (Array.isArray(m.js)) {
            if (!m.js.includes('zh-CN-patch.js')) {
                m.js.unshift('zh-CN-patch.js');
            }
        }
        
        // 添加 i18n
        if (!m.i18n) m.i18n = {};
        m.i18n['zh-CN'] = 'locales/zh-CN.json';
        
        fs.writeFileSync('$PLUGIN_DIR/manifest.json', JSON.stringify(m, null, 2));
        console.log('✓ manifest.json 已更新');
    "
else
    echo -e "${YELLOW}⚠ 未检测到 Node.js，请手动编辑 manifest.json${NC}"
    echo "  参考 manifest-patch.json 中的字段进行合并"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  安装完成！请重启酒馆即可看到中文界面       ║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║  如需卸载：                                  ║${NC}"
echo -e "${GREEN}║  1. 恢复 manifest.json.bak                   ║${NC}"
echo -e "${GREEN}║  2. 删除 zh-CN-patch.js 和 locales/          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
