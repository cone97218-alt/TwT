# TwT (阅读翻页插件) 文件结构与功能概述

该文件夹是一个用于 **SillyTavern** 的第三方扩展插件，名为 **“阅读”**（TwT）。其核心功能是将 SillyTavern 原本的上下滚动阅读转换为左右翻页阅读模式，并在此基础上提供了丰富的美化排版、章节目录、分段编辑和段评等功能。

以下是该目录下所有文件的功能掌管划分：

---

## 配置文件

*   **[manifest.json](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/manifest.json)**
    *   **掌管功能**：插件的元数据配置文件。
    *   **详细职责**：定义插件在 SillyTavern 中的显示名称（“阅读”）、作者、版本号、最低客户端版本限制，并指定主 JavaScript 入口文件（`index.js`） and 主样式表入口文件（`style.css`）。

---

## 页面结构与样式入口

*   **[index.html](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/index.html)**
    *   **掌管功能**：插件设置面板的 HTML 结构。
    *   **详细职责**：定义 SillyTavern 侧边栏/扩展设置区域 of UI，采用多 Tab 设计（设置、翻页、菜单、视觉、目录、段评），以及段评全屏编辑器的弹窗界面。
*   **[style.css](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/style.css)**
    *   **掌管功能**：插件样式总入口。
    *   **详细职责**：不包含具体样式代码，通过 `@import` 将各个功能模块的子样式表（`src/pagination/pagination.css`、`src/visual/visual.css`、`src/menu/menu.css`、`src/paragraph/paragraph.css`）进行聚合引入。

---

## 核心功能模块 (JS & CSS)

### 1. 主控制入口
*   **[index.js](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/index.js)**
    *   **掌管功能**：插件初始化与设置面板的交互逻辑。
    *   **详细职责**：注册默认设置参数；处理各个 Tab 的切换与显示；绑定设置界面中的各个输入框、复选框、下拉框的变化事件；管理预设（Visual Presets、正则预设）的保存与删除；监听 SillyTavern 全局主题的切换并自动联动相应的视觉预设。

### 2. 翻页逻辑模块 (Pagination)
*   **[pagination.js](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/pagination/pagination.js)**
    *   **掌管功能**：横向翻页的核心逻辑与手势/点击监听。
    *   **详细职责**：
        *   控制多列布局宽度，使 `#chat` 能够恰好按视口宽度横向排版。
        *   管理移动端虚拟键盘唤起防护，防止键盘弹出导致页面高度改变而打乱当前的翻页位置。
        *   绑定左右两侧点击区域（左 30% / 右 70%）的翻页动作。
        *   通过触摸事件（`touchstart`、`touchmove`、`touchend`）实现流畅的手势滑动翻页与对齐校正（Scroll Snap）。
        *   监听聊天切换事件（`CHAT_CHANGED`），处理事件的解绑与重新绑定。
*   **[pagination.css](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/pagination/pagination.css)**
    *   **掌管功能**：翻页模式的排版样式。
    *   **详细职责**：利用 CSS 多列布局（`column-width`、`column-fill`）将原本垂直滚动的聊天区域重塑为横向滑动的书本页；控制消息块（`.mes`）、图片、代码块、思维链的断页与防碎页控制；提供强行一消息一页（`break-before: column`）的样式。

### 3. 操作菜单模块 (Menu)
*   **[menu.js](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/menu/menu.js)**
    *   **掌管功能**：消息长按菜单与批量消息管理。
    *   **详细职责**：
        *   在聊天区域捕获鼠标左键长按或移动端单指长按，并在释放位置唤出自定义的操作菜单。
        *   集成 SillyTavern 原生动作快捷入口（如重新生成、滑动切换、全屏切换、单条隐藏、删除等）。
        *   提供“管理消息”弹窗，允许用户以复选框或按住 `Shift` 连选的方式，对聊天记录进行批量的显示、隐藏与物理删除。
*   **[menu.css](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/menu/menu.css)**
    *   **掌管功能**：长按菜单和消息管理器弹窗的视觉表现。
    *   **详细职责**：实现拟物化或毛玻璃风格的弹出菜单样式；定义消息管理弹窗（`#twt-range-modal`）在不同主题变量下的背景色、列表滚动条、多选框及操作按钮的布局。

### 4. 目录提取模块 (Mulu)
*   **[mulu.js](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/mulu/mulu.js)**
    *   **掌管功能**：章节目录（TOC）管理。
    *   **详细职责**：
        *   提供快捷按钮用于快速跳转 to 聊天的绝对开头、绝对结尾，或呼出目录面板。
        *   根据用户设置的正则表达式（如匹配 `第X章`、`# Markdown标题` 等），智能扫描并提取 AI 消息中的章节名。
        *   支持在目录弹窗内搜索过滤；点击对应章节平滑滚动定位到该段聊天所在的页面。
        *   集成批量选择章节并调用 API 批量生成小说段评（吐槽/间贴）的功能，自带日志面板查看器。

### 5. 段落处理与段评模块 (Paragraph)
*   **[paragraph.js](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/paragraph/paragraph.js)**
    *   **掌管功能**：分段编辑与 AI 段评。
    *   **详细职责**：
        *   将渲染后的 DOM 段落通过换行和 `<br>` 进行物理分割，并利用**动态规划（DP）对齐算法**将 DOM 节点与 Markdown 源码的文本块进行高精度双向绑定。
        *   实现段落级别的原地增删改功能（合并多段、修改并保存）。
        *   支持调用大语言模型（LLM）API 为选定的段落批量生成像小说网站一样的“本章说/间贴”读者弹幕吐槽。
*   **[paragraph.css](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/paragraph/paragraph.css)**
    *   **掌管功能**：分段编辑状态与段评侧边栏样式。
    *   **详细职责**：定义段落编辑时的“选中”、“删除线”、“已编辑”的高亮样式；定义悬浮工具栏和编辑弹窗的位置；控制段评弹幕抽屉的显示位置（left/right）、宽度和滑动动画。

### 6. 视觉美化模块 (Visual)
*   **[visual.js](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/visual/visual.js)**
    *   **掌管功能**：视觉排版设置应用。
    *   **详细职责**：在启用视觉美化时，动态将用户在面板中设置的留白（padding）、字号（font-size）、行高（line-height）、首行缩进（text-indent）、字间距等，作为 CSS 变量注入并应用到 `#chat` 容器上。
*   **[visual.css](file:///d:/SillyTavern/public/scripts/extensions/third-party/TwT/src/visual/visual.css)**
    *   **掌管功能**：视觉排版样式模板。
    *   **详细职责**：使用 CSS 变量（如 `--twt-font-size` 等）来承接 `visual.js` 写入的数据，真正改变段落字重、段落间距、对齐方式以及折叠控制栏的视觉表现。
