# Doom's Enhancement Suite 简体中文汉化补丁包

> 适配版本：DES v3.2+  
> 汉化风格：完整直译（不二次创作、不古风化）  
> 原理：运行时 DOM 文本替换 + SillyTavern i18n 语言文件（双保险）

---

## 📦 补丁包内容

```
DES-zh-CN-patch/
├── locales/
│   └── zh-CN.json          ← SillyTavern 标准 i18n 语言文件
├── zh-CN-patch.js           ← 运行时 DOM 汉化脚本（核心）
├── manifest-patch.json      ← manifest.json 合并片段
└── README.md                ← 本文件
```

---

## 🔧 安装步骤

### 方法一：覆盖安装（推荐）

1. **关闭酒馆**（完全退出）

2. **进入插件目录**：
   ```
   SillyTavern/public/scripts/extensions/Dooms-Enhancement-Suite/
   ```
   > 如果是通过酒馆扩展管理器安装的，路径可能是：
   > `SillyTavern/data/<用户名>/extensions/Dooms-Enhancement-Suite/`

3. **复制文件**：
   - 将 `locales/` 文件夹整个复制到插件目录下
   - 将 `zh-CN-patch.js` 复制到插件目录下

4. **修改 `manifest.json`**：
   打开插件目录下的 `manifest.json`，找到 `"js"` 字段：
   
   **修改前**（可能是）：
   ```json
   "js": "index.js"
   ```
   
   **修改后**：
   ```json
   "js": ["zh-CN-patch.js", "index.js"],
   "i18n": {
     "zh-CN": "locales/zh-CN.json"
   }
   ```
   
   > 如果 `"js"` 已经是数组，只需在数组**最前面**加上 `"zh-CN-patch.js"`

5. **重启酒馆**，在 用户设置 → 语言 中选择「简体中文」

### 方法二：仅用 JS 补丁（不改语言设置）

如果不想切换酒馆全局语言，只想汉化 DES 插件：

- 只需执行步骤 1-4 中**复制 `zh-CN-patch.js` 和修改 `js` 字段**的部分
- 不需要添加 `i18n` 字段
- 不需要复制 `locales/` 文件夹
- 重启后 DES 面板会自动显示中文

---

## ⚠️ 注意事项

1. **更新覆盖**：DES 插件更新时，你的 `manifest.json` 修改可能被覆盖。更新后需要重新执行步骤 4。

2. **部分英文残留**：以下位置的英文可能无法完全覆盖：
   - AI 生成内容中的英文（这是正常的，AI 输出取决于角色卡和预设）
   - 动态生成的 toast 通知（部分可能漏翻）
   - 第三方依赖内部的英文

3. **报告遗漏**：如果发现未翻译的文本，可以：
   - 在 `zh-CN-patch.js` 的 `I18N` 字典中添加对应条目
   - 格式：`"英文原文": "中文翻译",`
   - 保存后刷新页面即可

4. **提交 PR 给原作者**：本补丁最终目标是推动原仓库内置 i18n 支持。建议向 https://github.com/DangerDaza/Dooms-Enhancement-Suite 提交 PR，将 `zh-CN.json` 合入上游。

---

## 🙏 致谢

- 原插件作者：[DangerDaza](https://github.com/DangerDaza)
- 原插件基于 [SpicyMarinara's RPG Companion](https://github.com/SpicyMarinara) fork
- 汉化补丁由社区贡献
