/**
 * Doom's Enhancement Suite — 简体中文运行时汉化补丁
 * 版本: 1.0.0 (适配 DES v3.2)
 *
 * 原理: 监听 DOM 变化，将 DES 面板内的英文文本动态替换为中文。
 * 不修改任何原始文件，纯覆盖式注入。
 *
 * 安装: 将本文件放入插件目录，在 manifest.json 的 js 字段中
 *       将其加到 index.js 之前: "js": ["zh-CN-patch.js", "index.js"]
 */

(function () {
  'use strict';

  // ===== 翻译字典（与 locales/zh-CN.json 保持一致） =====
  const I18N = {
    // —— 模块/面板名 ——
    "Doom's Enhancement Suite": "厄运增强套件",
    "Present Characters": "在场角色",
    "Absent Characters": "离场角色",
    "Character Sheet": "角色档案",
    "Character Workshop": "角色工坊",
    "Scene Tracker": "场景追踪器",
    "Custom Scene Fields": "自定义场景字段",
    "Tracker Editor": "追踪器编辑器",
    "Lore Library": "设定库",
    "Chat Bubbles": "对话气泡",
    "Glint Words": "高光词",
    "Doom Counter": "厄运计数",
    "Plot Twist Generator": "剧情转折生成器",
    "Knives": "暗刀",
    "Portrait Bar": "头像栏",
    "History Persistence": "历史持久化",
    "Snapshots": "快照",

    // —— 场景追踪字段 ——
    "Time": "时间",
    "Date": "日期",
    "Location": "地点",
    "Weather": "天气",
    "Present": "在场",
    "Active Quest": "当前任务",
    "Recent Events": "近期事件",
    "Main Quest": "主线任务",
    "Side Quest": "支线任务",
    "Indoor": "室内",
    "Outdoor": "室外",

    // —— 布局模式 ——
    "Grid": "网格",
    "Stacked": "竖排",
    "Compact": "紧凑",
    "Banner": "横幅",
    "HUD": "悬浮面板",
    "Floating Panel": "可拖拽悬浮窗",
    "Ticker": "滚动条",

    // —— 角色卡字段 ——
    "Relationship": "关系",
    "Status": "状态",
    "Thoughts": "内心活动",
    "Custom Tracker": "自定义追踪项",
    "Dialogue Color": "对话颜色",
    "Upload Image": "上传头像",
    "Remove Character": "移除角色",
    "Set Color": "设置颜色",
    "Expressions Sync": "表情同步",
    "Aliases": "别名",
    "Identity": "身份",
    "Base": "基础",
    "Version": "版本",
    "Clone": "克隆",
    "Live": "生效中",

    // —— Doom Counter / 暗刀 ——
    "Tension": "紧张值",
    "Tension Ceiling": "紧张值上限",
    "Streak": "连续计数",
    "Threshold": "阈值",
    "Plot Twist": "剧情转折",
    "Generate Twist": "生成转折",
    "Knife": "暗刀",
    "Armed Knives": "已装载暗刀",
    "Add Knife": "添加暗刀",
    "Pick a Twist": "选择一个转折",
    "The counter struck": "计数触发",
    "Short Fuse": "短引信",

    // —— 高光词 ——
    "Group": "分组",
    "Look": "外观",
    "Effect": "出现效果",
    "After Effect": "持续效果",
    "Gold": "金",
    "Silver": "银",
    "Bronze": "铜",
    "Crimson": "绯红",
    "Ember": "余烬",
    "Arcane": "奥术",
    "Frost": "霜",
    "Ocean": "深海",
    "Toxic": "剧毒",
    "Radiant": "辉光",
    "Shadow": "暗影",
    "Rose": "玫瑰",
    "Prism": "棱镜",
    "Flash": "闪光",
    "Sparkle": "星火迸发",
    "Shockwave": "冲击波",
    "Pop": "弹出",
    "Shine": "反光",
    "Glow Pulse": "呼吸发光",
    "Flowing Color": "流光",
    "Twinkle": "微闪",
    "Rising Sparks": "升腾火花",
    "Flicker": "闪烁",
    "Heartbeat": "心跳脉冲",
    "Color Cycle": "色彩循环",
    "Underline Sweep": "下划线扫光",
    "Float": "浮起",
    "Glitch": "故障感",

    // —— 天气 ——
    "Rain": "雨",
    "Snow": "雪",
    "Wind": "风",
    "Atmosphere": "氛围",
    "Dynamic Weather": "动态天气",
    "Indoor Detection": "室内识别",

    // —— 通用设置 ——
    "Enable": "启用",
    "Disable": "停用",
    "Enabled": "已启用",
    "Disabled": "已停用",
    "Settings": "设置",
    "Theme": "主题",
    "Classic": "经典",
    "Grimoire": "账簿风",
    "Ops Console": "终端风",
    "Lumen": "磨砂玻璃",
    "Arcade": "街机 HUD",
    "Inked": "漫画分镜",
    "Save": "保存",
    "Restore": "恢复",
    "Reset": "重置",
    "Lock": "锁定",
    "Unlock": "解锁",
    "Import": "导入",
    "Export": "导出",
    "Add": "添加",
    "Delete": "删除",
    "Edit": "编辑",
    "Close": "关闭",

    // —— Bunny Mo ——
    "Bunny Mo Integration": "Bunny Mo 集成",
    "Full Sheet": "完整档案",
    "Quick Sheet": "速览档案",
    "Collapsible Sections": "可折叠分区",

    // —— 气泡 ——
    "Discord Style": "Discord 风格",
    "Card Style": "卡片风格",

    // —— 角色面板设置 ——
    "Per-chat character tracking": "按聊天独立追踪角色",
    "Card size": "卡片尺寸",
    "Spacing": "间距",
    "Border radius": "圆角",
    "Glow intensity": "发光强度",
    "Position": "位置",
    "Above input": "输入框上方",
    "Below input": "输入框下方",
    "Top of screen": "屏幕顶部",
    "Hide native expression display": "隐藏原生表情显示",

    // —— 右键菜单 ——
    "Cancel pending inject": "取消待注入",
    "Remove from scene": "从场景中移除",
    "Open character sheet": "打开角色档案",
    "Open workshop": "打开工坊",

    // —— 战役 ——
    "Campaign": "战役",
    "Create campaign": "创建战役",
    "Delete campaign": "删除战役",
    "Active campaign": "当前战役",

    // —— 注入 ——
    "Inject": "注入",
    "Injection": "注入",
    "Pending": "待处理",
    "Confirmed": "已确认",

    // —— 其他 ——
    "Dialogue Coloring": "对话着色",
    "Quest Tracking": "任务追踪",
    "What's New": "更新日志",
    "Changelog": "变更记录",
    "Reload required": "需要刷新页面",
    "Extension enabled": "扩展已启用",
    "Extension disabled": "扩展已停用",

    // —— placeholder / title 类 ——
    "Search characters...": "搜索角色…",
    "Enter character name...": "输入角色名…",
    "Set relationship...": "设置关系…",
    "Set status...": "设置状态…",
    "Add tracker field...": "添加追踪项…",
    "Enter quest description...": "输入任务描述…",
  };

  // ===== DOM 替换引擎 =====

  // 已翻译过的节点标记（避免重复处理）
  const TRANSLATED_ATTR = 'data-zh-done';

  /**
   * 对单个文本节点进行替换
   */
  function translateTextNode(node) {
    if (node.parentNode.hasAttribute(TRANSLATED_ATTR)) return;
    const original = node.textContent.trim();
    if (!original) return;
    if (I18N[original]) {
      node.textContent = node.textContent.replace(original, I18N[original]);
    }
  }

  /**
   * 对元素属性进行替换 (title, placeholder, aria-label)
   */
  function translateAttributes(el) {
    if (el.hasAttribute(TRANSLATED_ATTR)) return;
    const attrs = ['title', 'placeholder', 'aria-label'];
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (val && I18N[val]) {
        el.setAttribute(attr, I18N[val]);
      }
    }
  }

  /**
   * 递归遍历并翻译元素
   */
  function translateElement(el) {
    if (el.hasAttribute && el.hasAttribute(TRANSLATED_ATTR)) return;

    // 跳过 script / style / 已翻译区域
    if (el.nodeName === 'SCRIPT' || el.nodeName === 'STYLE') return;

    // 翻译属性
    if (el.nodeType === Node.ELEMENT_NODE) {
      translateAttributes(el);

      // 翻译文本内容（只处理直接文本子节点）
      const childNodes = Array.from(el.childNodes);
      for (const child of childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          translateTextNode(child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          translateElement(child);
        }
      }

      // 标记为已翻译
      el.setAttribute(TRANSLATED_ATTR, '1');
    }
  }

  /**
   * 扫描 DES 相关容器
   */
  function scanDESContainers() {
    // DES 面板通常挂在特定容器内，我们扫描整个 body 中可能属于 DES 的区域
    const selectors = [
      '[id*="doom"]',
      '[id*="des-"]',
      '[class*="doom"]',
      '[class*="des-"]',
      '[data-extension*="Doom"]',
      '.present-characters',
      '.scene-tracker',
      '.chat-bubbles',
      '.doom-counter',
      '.glint-words',
      '.lore-library',
      '.portrait-bar',
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        translateElement(el);
      }
    }
  }

  /**
   * 全局扫描（兜底：扫描所有未标记元素）
   */
  function globalScan() {
    const all = document.querySelectorAll('body *:not([data-zh-done])');
    for (const el of all) {
      if (el.nodeName === 'SCRIPT' || el.nodeName === 'STYLE') continue;
      // 只处理包含 DES 相关 class/id 的元素及其子树
      const id = (el.id || '').toLowerCase();
      const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
      if (id.includes('doom') || id.includes('des-') || cls.includes('doom') || cls.includes('des-') ||
          id.includes('portrait') || id.includes('scene-track') || id.includes('glint') ||
          id.includes('lore-lib') || id.includes('chat-bubbl') || cls.includes('portrait') ||
          cls.includes('scene-track') || cls.includes('glint') || cls.includes('lore-lib') ||
          cls.includes('chat-bubbl')) {
        translateElement(el);
      }
    }
  }

  // ===== MutationObserver 监听动态内容 =====
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            translateElement(node);
          }
        }
      }
      if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
        translateAttributes(mutation.target);
      }
    }
  });

  // 启动观察
  function init() {
    // 初始扫描
    scanDESContainers();
    globalScan();

    // 监听后续 DOM 变化
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title', 'placeholder', 'aria-label'],
    });

    console.log('%c[DES 汉化补丁] 已加载 ✓', 'color: #4CAF50; font-weight: bold;');
  }

  // 等待 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // DES 面板可能在扩展激活后才渲染，额外延迟扫描
  setTimeout(() => { scanDESContainers(); globalScan(); }, 1000);
  setTimeout(() => { scanDESContainers(); globalScan(); }, 3000);
  setTimeout(() => { scanDESContainers(); globalScan(); }, 5000);

})();
