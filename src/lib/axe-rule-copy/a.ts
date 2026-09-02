import type { StaticAxeRuleCopy } from "./types";

/**
 * Static, reviewed copy for the first alphabetic segment of the axe catalog.
 * Keep every sentence specific to the rule; do not replace entries with a
 * generated translation or a shared catch-all explanation.
 */
export const RULE_COPY_A: Record<string, StaticAxeRuleCopy> = {
  accesskeys: {
    en: {
      name: "Unique accesskey values",
      what: "Every accesskey value must be used by only one element on the page.",
      who: "People who use keyboard shortcuts or assistive technology that exposes access keys",
      why: "Duplicate shortcuts can activate the wrong control and make keyboard navigation unpredictable.",
    },
    zh: {
      name: "accesskey 值唯一",
      what: "页面上的每个 accesskey 值只能分配给一个元素。",
      who: "使用键盘快捷键，或使用会暴露访问键的辅助技术的用户",
      why: "重复的快捷键可能触发错误控件，让键盘操作变得不可预测。",
    },
  },
  "area-alt": {
    en: {
      name: "Alternative text for image-map areas",
      what: "Each active area in an image map needs an accessible name that describes its destination or action.",
      who: "Screen-reader users and anyone who cannot perceive the image map",
      why: "Without an accessible name, users cannot identify or choose the links represented by the image map.",
    },
    zh: {
      name: "图像映射区域的替代文本",
      what: "图像映射中的每个活动 area 都需要描述其目的地或操作的可访问名称。",
      who: "屏幕阅读器用户，以及无法感知图像映射的用户",
      why: "没有可访问名称时，用户无法识别或选择图像映射所代表的链接。",
    },
  },
  "aria-allowed-attr": {
    en: {
      name: "ARIA attributes allowed by the role",
      what: "An element may expose only ARIA attributes supported by its native or assigned role.",
      who: "Screen-reader users who rely on accurate roles and states",
      why: "Unsupported states can be ignored or announced incorrectly, producing a misleading interface.",
    },
    zh: {
      name: "角色允许的 ARIA 属性",
      what: "元素只能提供其原生角色或指定角色所支持的 ARIA 属性。",
      who: "依赖准确角色和状态信息的屏幕阅读器用户",
      why: "不受支持的状态可能被忽略或错误播报，导致用户误解界面。",
    },
  },
  "aria-allowed-role": {
    en: {
      name: "Appropriate ARIA role",
      what: "A role assigned to an element must be valid for that element and its semantics.",
      who: "People using screen readers or other role-aware assistive technology",
      why: "An inappropriate role changes how a control is understood and may expose interactions that do not work as announced.",
    },
    zh: {
      name: "合适的 ARIA 角色",
      what: "分配给元素的角色必须适用于该元素及其语义。",
      who: "使用屏幕阅读器或其他依赖角色信息的辅助技术的用户",
      why: "不合适的角色会改变控件的理解方式，甚至播报无法实现的交互。",
    },
  },
  "aria-braille-equivalent": {
    en: {
      name: "Non-braille equivalents for ARIA braille properties",
      what: "aria-braillelabel and aria-brailleroledescription must be accompanied by equivalent non-braille semantics.",
      who: "Screen-reader users, including people using braille displays and speech output",
      why: "A braille-only label or role description leaves speech users and other modalities without the same meaning.",
    },
    zh: {
      name: "ARIA 点字属性的非点字等价信息",
      what: "aria-braillelabel 和 aria-brailleroledescription 必须同时提供等价的非点字语义。",
      who: "屏幕阅读器用户，包括使用点字显示器或语音输出的用户",
      why: "只有点字形式的标签或角色描述，会让语音用户和其他输出方式缺少同等信息。",
    },
  },
  "aria-command-name": {
    en: {
      name: "Accessible names for ARIA commands",
      what: "Every element with the button, link, or menuitem role needs an accessible name.",
      who: "Screen-reader users and people who navigate commands by voice",
      why: "The name tells users what a command does and lets them find and invoke it confidently.",
    },
    zh: {
      name: "ARIA 命令的可访问名称",
      what: "具有 button、link 或 menuitem 角色的每个元素都需要可访问名称。",
      who: "屏幕阅读器用户，以及通过语音导航命令的用户",
      why: "名称能说明命令的作用，让用户可以找到并放心执行它。",
    },
  },
  "aria-conditional-attr": {
    en: {
      name: "ARIA attributes valid for the role",
      what: "Conditional ARIA attributes must be used only when the element's role and state make them applicable.",
      who: "Assistive-technology users who depend on consistent ARIA states and relationships",
      why: "A state used outside its role's rules can be misleading, unavailable, or interpreted differently across browsers.",
    },
    zh: {
      name: "符合角色条件的 ARIA 属性",
      what: "只有当元素的角色和状态使其适用时，才能使用条件性的 ARIA 属性。",
      who: "依赖一致 ARIA 状态和关系信息的辅助技术用户",
      why: "在角色规则之外使用状态会造成误导，也可能无法使用或在浏览器间产生不同解释。",
    },
  },
  "aria-deprecated-role": {
    en: {
      name: "No deprecated ARIA roles",
      what: "Elements must not use ARIA roles that the specification has deprecated.",
      who: "Screen-reader users whose experience depends on current accessibility semantics",
      why: "Deprecated roles may lose support or carry different meanings, making the interface unreliable over time.",
    },
    zh: {
      name: "不得使用已弃用的 ARIA 角色",
      what: "元素不得使用规范已标记为弃用的 ARIA 角色。",
      who: "体验依赖当前无障碍语义的屏幕阅读器用户",
      why: "已弃用角色可能失去支持或改变含义，使界面长期变得不可靠。",
    },
  },
  "aria-dialog-name": {
    en: {
      name: "Accessible name for ARIA dialogs",
      what: "Every dialog or alertdialog needs an accessible name, usually supplied by a visible heading or label.",
      who: "Screen-reader users who need to identify a dialog before interacting with it",
      why: "A name announces the dialog's purpose and distinguishes it from the page and other open dialogs.",
    },
    zh: {
      name: "ARIA 对话框的可访问名称",
      what: "每个 dialog 或 alertdialog 都需要可访问名称，通常来自可见标题或标签。",
      who: "需要在操作前识别对话框的屏幕阅读器用户",
      why: "名称能播报对话框的用途，并将其与页面和其他打开的对话框区分开。",
    },
  },
  "aria-hidden-body": {
    en: {
      name: "The document body must not be aria-hidden",
      what: 'The document body must not carry aria-hidden="true".',
      who: "Screen-reader users who need access to the document's content",
      why: "Hiding the body removes the page from the accessibility tree and can make the entire interface unavailable.",
    },
    zh: {
      name: "文档 body 不得隐藏",
      what: '文档 body 不得带有 aria-hidden="true"。',
      who: "需要访问文档内容的屏幕阅读器用户",
      why: "隐藏 body 会把整页从无障碍树中移除，可能让整个界面都无法使用。",
    },
  },
  "aria-hidden-focus": {
    en: {
      name: "No focusable content inside aria-hidden elements",
      what: "An element marked aria-hidden must not itself be focusable or contain anything that can receive focus.",
      who: "Keyboard and screen-reader users moving through the accessibility tree",
      why: "A user can land on a control that assistive technology says does not exist, losing context and control.",
    },
    zh: {
      name: "aria-hidden 元素内不得有可聚焦内容",
      what: "标记为 aria-hidden 的元素本身不得可聚焦，也不得包含可接收焦点的内容。",
      who: "在无障碍树中移动的键盘用户和屏幕阅读器用户",
      why: "用户可能聚焦到辅助技术声称不存在的控件，从而失去上下文和控制权。",
    },
  },
  "aria-input-field-name": {
    en: {
      name: "Accessible name for ARIA input fields",
      what: "Every ARIA input field needs a programmatically determinable accessible name.",
      who: "Screen-reader users filling in forms and people using voice input",
      why: "The name identifies what information the field accepts and allows it to be found and completed accurately.",
    },
    zh: {
      name: "ARIA 输入字段的可访问名称",
      what: "每个 ARIA 输入字段都需要程序可确定的可访问名称。",
      who: "填写表单的屏幕阅读器用户，以及使用语音输入的用户",
      why: "名称能说明字段要接收的信息，帮助用户准确找到并完成填写。",
    },
  },
  "aria-meter-name": {
    en: {
      name: "Accessible name for ARIA meters",
      what: "Every element with the meter role needs an accessible name that identifies what is being measured.",
      who: "Screen-reader users monitoring a value or progress measurement",
      why: "Without a name, the numeric value is announced without its subject or meaning.",
    },
    zh: {
      name: "ARIA meter 的可访问名称",
      what: "每个具有 meter 角色的元素都需要说明测量对象的可访问名称。",
      who: "监测数值或测量进度的屏幕阅读器用户",
      why: "没有名称时，辅助技术只能播报数字，却无法说明数字代表什么。",
    },
  },
  "aria-progressbar-name": {
    en: {
      name: "Accessible name for ARIA progress bars",
      what: "Every element with the progressbar role needs an accessible name describing the operation or task in progress.",
      who: "Screen-reader users waiting for a task to finish",
      why: "The name gives context to the percentage or status announced by the progress bar.",
    },
    zh: {
      name: "ARIA 进度条的可访问名称",
      what: "每个 progressbar 角色元素都需要一个可访问名称，用于说明正在进行的操作或任务。",
      who: "等待任务完成的屏幕阅读器用户",
      why: "名称为进度条播报的百分比或状态提供必要上下文。",
    },
  },
  "aria-prohibited-attr": {
    en: {
      name: "No prohibited ARIA attributes",
      what: "An element must not expose an ARIA attribute that its role explicitly prohibits.",
      who: "Assistive-technology users relying on valid role, property, and state combinations",
      why: "A prohibited property can conflict with native semantics and cause incorrect or confusing announcements.",
    },
    zh: {
      name: "不得使用被角色禁止的 ARIA 属性",
      what: "元素不得提供其角色明确禁止的 ARIA 属性。",
      who: "依赖有效角色、属性和状态组合的辅助技术用户",
      why: "被禁止的属性可能与原生语义冲突，造成错误或令人困惑的播报。",
    },
  },
  "aria-required-attr": {
    en: {
      name: "Required ARIA attributes",
      what: "An element with an ARIA role must include every property or state required by that role.",
      who: "Screen-reader users who need a complete description of interactive widgets",
      why: "Missing required information prevents assistive technology from presenting the widget's state or purpose correctly.",
    },
    zh: {
      name: "必需的 ARIA 属性",
      what: "带有 ARIA 角色的元素必须包含该角色要求的每个属性或状态。",
      who: "需要完整了解交互组件的屏幕阅读器用户",
      why: "缺少必需信息会让辅助技术无法正确呈现组件的状态或用途。",
    },
  },
  "aria-required-children": {
    en: {
      name: "Required child roles",
      what: "A composite ARIA widget must contain the child roles required by its parent role.",
      who: "Screen-reader users navigating structured widgets such as lists, grids, and tabs",
      why: "The expected role hierarchy lets assistive technology report the widget structure and navigation model.",
    },
    zh: {
      name: "必需的 ARIA 子角色",
      what: "复合 ARIA 组件必须包含其父角色所要求的子角色。",
      who: "操作列表、网格和标签页等结构化组件的屏幕阅读器用户",
      why: "正确的角色层级帮助辅助技术呈现组件结构和导航方式。",
    },
  },
  "aria-required-parent": {
    en: {
      name: "Required parent roles",
      what: "An ARIA child role must be contained by the parent role required by its specification.",
      who: "Screen-reader users navigating hierarchical widgets",
      why: "The parent relationship supplies the context needed to understand an item's position and behavior.",
    },
    zh: {
      name: "必需的 ARIA 父角色",
      what: "ARIA 子角色必须包含在规范要求的父角色中。",
      who: "操作层级化组件的屏幕阅读器用户",
      why: "父子关系提供理解项目位置和行为所需的上下文。",
    },
  },
  "aria-roledescription": {
    en: {
      name: "ARIA role description requires a semantic role",
      what: "aria-roledescription may be used only on an element that has an implicit or explicit semantic role.",
      who: "Screen-reader users who rely on role announcements",
      why: "A description without a valid role can replace useful semantics with an unexplained label.",
    },
    zh: {
      name: "ARIA 角色描述必须依附语义角色",
      what: "aria-roledescription 只能用于具有隐式或显式语义角色的元素。",
      who: "依赖角色播报的屏幕阅读器用户",
      why: "没有有效角色的描述可能取代有用语义，只留下无法理解的标签。",
    },
  },
  "aria-roles": {
    en: {
      name: "Valid ARIA role values",
      what: "Every role attribute must contain a role value defined by the ARIA specification.",
      who: "Assistive-technology users who depend on standardized semantics",
      why: "An unknown role cannot reliably communicate an element's type, state, or interaction model.",
    },
    zh: {
      name: "有效的 ARIA 角色值",
      what: "每个 role 属性都必须使用 ARIA 规范定义的角色值。",
      who: "依赖标准化语义的辅助技术用户",
      why: "未知角色无法可靠传达元素的类型、状态或交互方式。",
    },
  },
  "aria-tab-name": {
    en: {
      name: "Accessible name for ARIA tabs",
      what: "Every element with the tab role needs an accessible name that identifies the tab's panel or topic.",
      who: "Screen-reader users switching between tab panels",
      why: "A clear tab name lets users choose the right panel and understand which tab is selected.",
    },
    zh: {
      name: "ARIA 标签页的可访问名称",
      what: "每个具有 tab 角色的元素都需要标识其面板或主题的可访问名称。",
      who: "在标签页面板之间切换的屏幕阅读器用户",
      why: "清晰的名称让用户选择正确面板，并理解当前选中的标签页。",
    },
  },
  "aria-text": {
    en: {
      name: "Text role must not contain focusable descendants",
      what: "An element with role=text must not contain descendants that can receive keyboard focus.",
      who: "Keyboard and screen-reader users encountering text grouped as one phrase",
      why: "Focusable descendants break the text abstraction and can make navigation or announcement confusing.",
    },
    zh: {
      name: "text 角色不得包含可聚焦后代",
      what: "带有 role=text 的元素不得包含能够接收键盘焦点的后代元素。",
      who: "遇到被合并为一个短语的文本的键盘用户和屏幕阅读器用户",
      why: "可聚焦后代会破坏文本整体语义，让导航或播报变得混乱。",
    },
  },
  "aria-toggle-field-name": {
    en: {
      name: "Accessible name for ARIA toggle fields",
      what: "Every ARIA toggle field needs an accessible name that identifies the setting it changes.",
      who: "Screen-reader and voice-control users operating on/off settings",
      why: "Users need both the setting's name and its current state to decide what changing it will do.",
    },
    zh: {
      name: "ARIA 切换字段的可访问名称",
      what: "每个 ARIA 切换字段都需要一个可访问名称，用于说明它所控制的设置。",
      who: "使用屏幕阅读器或语音控制操作开关设置的用户",
      why: "用户需要同时了解设置名称和当前状态，才能判断切换操作的结果。",
    },
  },
  "aria-tooltip-name": {
    en: {
      name: "Accessible name for ARIA tooltips",
      what: "Every element with the tooltip role needs an accessible name for the information it provides.",
      who: "Screen-reader users who receive tooltip content non-visually",
      why: "Naming the tooltip makes its supplemental information identifiable when it is announced.",
    },
    zh: {
      name: "ARIA 工具提示的可访问名称",
      what: "每个具有 tooltip 角色的元素都需要为其提供的信息设置可访问名称。",
      who: "以非视觉方式接收工具提示内容的屏幕阅读器用户",
      why: "为工具提示命名后，辅助技术播报时用户才能识别这段补充信息。",
    },
  },
  "aria-treeitem-name": {
    en: {
      name: "Accessible name for ARIA tree items",
      what: "Every treeitem needs an accessible name that identifies the item in the tree.",
      who: "Screen-reader users navigating hierarchical trees",
      why: "The name distinguishes each item and lets users understand what they can expand, select, or activate.",
    },
    zh: {
      name: "ARIA 树节点的可访问名称",
      what: "每个 treeitem 都需要一个可访问名称，用于标识该项目在树中的内容或位置。",
      who: "浏览层级树的屏幕阅读器用户",
      why: "清晰的名称能区分各个项目，并帮助用户理解哪些项目可展开、选择或激活。",
    },
  },
  "aria-valid-attr": {
    en: {
      name: "Valid ARIA attribute names",
      what: "Attributes beginning with aria- must be recognized ARIA attributes defined by the specification.",
      who: "Assistive-technology users who depend on standardized ARIA semantics",
      why: "A misspelled or invented attribute is ignored and cannot communicate the intended state or relationship.",
    },
    zh: {
      name: "有效的 ARIA 属性名称",
      what: "以 aria- 开头的属性必须是规范定义且可识别的 ARIA 属性。",
      who: "依赖标准 ARIA 语义的辅助技术用户",
      why: "拼写错误或自定义的属性会被忽略，无法传达预期状态或关系。",
    },
  },
  "aria-valid-attr-value": {
    en: {
      name: "Valid values for ARIA attributes",
      what: "Each ARIA attribute must use a value allowed by that attribute's definition.",
      who: "Screen-reader users relying on accurate states and property values",
      why: "An invalid value may be ignored or interpreted inconsistently, hiding the control's real state.",
    },
    zh: {
      name: "有效的 ARIA 属性值",
      what: "每个 ARIA 属性都必须使用其定义允许的值。",
      who: "依赖准确状态和属性值的屏幕阅读器用户",
      why: "无效值可能被忽略或产生不一致的解释，让控件的真实状态不可见。",
    },
  },
  "audio-caption": {
    en: {
      name: "Captions for audio content",
      what: "Audio elements must provide a captions track that conveys spoken content and relevant sounds.",
      who: "Deaf or hard-of-hearing users and anyone listening without audio",
      why: "Captions provide an equivalent way to follow the information carried by the soundtrack.",
    },
    zh: {
      name: "音频内容的字幕",
      what: "audio 元素必须提供传达对白和相关声音的字幕轨道。",
      who: "聋人、听力受限用户，以及无法播放声音的用户",
      why: "字幕为用户提供理解音轨信息的等价途径。",
    },
  },
  "autocomplete-valid": {
    en: {
      name: "Valid autocomplete purpose",
      what: "The autocomplete value on a form field must be valid and describe the field's expected purpose.",
      who: "People using autofill, cognitive assistance, or alternative input methods",
      why: "A correct purpose lets browsers and assistive tools offer the right saved information without guesswork.",
    },
    zh: {
      name: "有效的 autocomplete 用途",
      what: "表单字段的 autocomplete 值必须有效，并准确描述字段预期用途。",
      who: "使用自动填充、认知辅助或替代输入方式的用户",
      why: "正确的用途让浏览器和辅助工具无需猜测就能提供恰当的已保存信息。",
    },
  },
  "avoid-inline-spacing": {
    en: {
      name: "Adjustable text spacing",
      what: "Inline styles must not prevent users from overriding text spacing with a custom stylesheet.",
      who: "People with dyslexia, low vision, or other reading needs who customize text presentation",
      why: "Allowing spacing overrides keeps text readable when users apply their preferred typography settings.",
    },
    zh: {
      name: "可调整的文本间距",
      what: "内联样式不得阻止用户通过自定义样式表覆盖文本间距。",
      who: "有阅读障碍、低视力或其他阅读需求并会自定义文字呈现的用户",
      why: "允许覆盖间距，用户采用偏好的排版设置后仍能清楚阅读文本。",
    },
  },
  blink: {
    en: {
      name: "No blinking content",
      what: "The page must not use the obsolete blink element to create blinking text or content.",
      who: "People with photosensitivity, attention difficulties, or anyone who needs stable content",
      why: "Blinking can distract users, make content hard to read, and create seizure or other health risks.",
    },
    zh: {
      name: "不得使用闪烁内容",
      what: "页面不得使用已废弃的 blink 元素创建闪烁文本或内容。",
      who: "有光敏感、注意力困难，或需要稳定内容的用户",
      why: "闪烁会分散注意力、降低可读性，并可能带来癫痫发作等健康风险。",
    },
  },
  "button-name": {
    en: {
      name: "Discernible button text",
      what: "Every button must have an accessible name that describes the action it performs.",
      who: "Screen-reader users and people using voice control",
      why: "A meaningful name lets users identify the button, understand its action, and activate the right control.",
    },
    zh: {
      name: "可识别的按钮文本",
      what: "每个按钮都必须有描述其执行操作的可访问名称。",
      who: "屏幕阅读器用户和使用语音控制的用户",
      why: "有意义的名称帮助用户识别按钮、理解作用并激活正确的控件。",
    },
  },
  bypass: {
    en: {
      name: "Bypass repeated navigation",
      what: "Each page needs a mechanism, such as a skip link or landmark, to move past repeated blocks to the main content.",
      who: "Keyboard and screen-reader users who visit multiple pages in the same site",
      why: "Skipping repeated navigation saves time and prevents users from traversing the same controls on every page.",
    },
    zh: {
      name: "跳过重复导航",
      what: "每个页面都需要通过跳过链接或地标等机制，从重复区块直接到达主要内容。",
      who: "在同一网站浏览多个页面的键盘用户和屏幕阅读器用户",
      why: "跳过重复导航可以节省时间，避免用户每页都重复经过相同控件。",
    },
  },
  "color-contrast": {
    en: {
      name: "AA text and control contrast",
      what: "Foreground and background colors must meet the WCAG 2 AA minimum contrast ratio for the content being presented.",
      who: "People with low vision, color-vision differences, or glare on their display",
      why: "Sufficient contrast makes text and meaningful visual controls distinguishable without relying on perfect vision.",
    },
    zh: {
      name: "AA 级文本和控件对比度",
      what: "前景色与背景色必须达到 WCAG 2 AA 对当前内容规定的最低对比度。",
      who: "低视力、色觉差异或屏幕存在眩光的用户",
      why: "足够的对比度让用户无需依赖完美视力也能分辨文本和有意义的视觉控件。",
    },
  },
  "color-contrast-enhanced": {
    en: {
      name: "AAA enhanced color contrast",
      what: "Foreground and background colors must meet the stricter WCAG 2 AAA enhanced contrast ratio.",
      who: "People with low vision or significant difficulty distinguishing low-contrast content",
      why: "The enhanced threshold improves legibility for users who need stronger separation between text and its background.",
    },
    zh: {
      name: "AAA 级增强颜色对比度",
      what: "前景色与背景色必须达到 WCAG 2 AAA 更严格的增强对比度。",
      who: "低视力或难以分辨低对比度内容的用户",
      why: "更高的阈值让需要更强文本与背景区分度的用户更容易阅读。",
    },
  },
} satisfies Record<string, StaticAxeRuleCopy>;

export const AXE_RULE_COPY_A = RULE_COPY_A;
export default RULE_COPY_A;
