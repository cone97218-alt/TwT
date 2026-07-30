# SillyTavern UI 精简瘦身拓展 (UI Trimmer - `cut`)

一个专注于精简 SillyTavern 界面上无用/易误触元素的第三方扩展。

---

## 📌 模块一（当前已上线功能）

1. **隐藏问号图标引导及教程类**
   - 隐藏设置项旁、参数调整面板、标题栏及页面各处的问号帮助图标（`.note-link-span`, `.notes-link`, `fa-circle-question` 等）。
2. **隐藏选择语言设置框**
   - 隐藏用户设置 (User Settings) 及初始引导页中的界面语言选择框 (`#UI-language-block` / `#onboarding-UI-language-block`)。
3. **隐藏三连跳转链接**
   - 隐藏欢迎面板与顶部快捷栏中的官方文档 (Docs)、GitHub 仓库与 Discord 社区跳转图标。

---

## 🛠️ 安装与使用

1. 将本文件夹 `cut` 放置在酒馆的扩展目录中：
   `SillyTavern/public/scripts/extensions/third-party/cut`
2. 刷新或重新加载 SillyTavern 页面。
3. 打开右侧或顶部的 **拓展 (Extensions)** 菜单，即可看到 **UI 精简瘦身 (UI Trimmer)** 的设置面板。
4. 可根据需求开启/关闭总开关或单独控制各个精简选项。

---

## 🧩 扩展架构说明

- `manifest.json`: 酒馆拓展清单配置。
- `style.css`: 采用 HTML `body` Class 响应式打标的零延迟隐藏 CSS 规则。
- `index.js`: 模块逻辑控制与拓展设置面板渲染，使用 `saveSettingsDebounced` 持久化保存用户的选项配置。
- **模块化预留**：架构上采用 `module1`, `module2` 结构，后续随时可添加其他精简模块与新功能。
