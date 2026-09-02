import type { StaticAxeRuleCopy } from "./types";

/**
 * Explicit reviewed copy for the latter part of the axe catalog.  Each rule
 * has its own explanation in both languages; this module deliberately has no
 * translation or category-template fallback logic.
 */
export const RULE_COPY_C: Record<string, StaticAxeRuleCopy> = {
  "landmark-one-main": {
    en: {
      name: "A main landmark",
      what: "A document must contain one main landmark for its primary content.",
      who: "Screen-reader and keyboard users bypassing navigation.",
      why: "A main region gives users a reliable way to reach the page's central content.",
    },
    zh: {
      name: "页面主要内容地标",
      what: "文档必须包含一个承载主要内容的 main 地标。",
      who: "跳过导航的屏幕阅读器和键盘用户。",
      why: "main 区域为到达页面核心内容提供可靠路径。",
    },
  },
  "landmark-unique": {
    en: {
      name: "Unique landmark identity",
      what: "Landmarks need a unique role, or a unique role/name combination when multiple instances exist.",
      who: "Screen-reader users navigating a landmark list.",
      why: "Distinct landmark identities let users choose the intended region quickly.",
    },
    zh: {
      name: "地标身份唯一",
      what: "地标应有唯一角色；同类地标多个存在时，还要有唯一的角色与名称组合。",
      who: "通过地标列表导航的屏幕阅读器用户。",
      why: "不同的地标身份能让用户快速选择目标区域。",
    },
  },
  "link-in-text-block": {
    en: {
      name: "Links distinguished without color",
      what: "A link in a text block must be distinguishable from surrounding text without color alone.",
      who: "People with color-vision differences and users viewing in monochrome or glare.",
      why: "An additional visual cue makes the link discoverable when color differences disappear.",
    },
    zh: {
      name: "链接不只依赖颜色",
      what: "文本块中的链接不能只靠颜色与周围文字区分。",
      who: "有色觉差异的用户，以及在单色或眩光环境中阅读的用户。",
      why: "额外的视觉提示能在颜色差异消失时仍让用户发现链接。",
    },
  },
  "link-name": {
    en: {
      name: "Link accessible name",
      what: "Every link needs discernible text or another accessible name.",
      who: "Screen-reader users browsing a page through its link list.",
      why: "The name tells users where the link leads or what resource it opens.",
    },
    zh: {
      name: "链接可访问名称",
      what: "每个链接都要有可辨识文本或其他可访问名称。",
      who: "通过链接列表浏览页面的屏幕阅读器用户。",
      why: "名称能说明链接指向哪里或会打开什么资源。",
    },
  },
  list: {
    en: {
      name: "List structure",
      what: "A ul or ol may directly contain only list items and permitted script, template, or structural elements.",
      who: "Screen-reader users relying on list counts and item navigation.",
      why: "Valid nesting lets assistive technology announce the list and its items accurately.",
    },
    zh: {
      name: "列表结构",
      what: "ul 或 ol 只能直接包含列表项，以及允许的 script、template 或结构元素。",
      who: "依赖列表数量和项目导航的屏幕阅读器用户。",
      why: "正确嵌套能让辅助技术准确播报列表及其项目。",
    },
  },
  listitem: {
    en: {
      name: "List-item semantics",
      what: "Every li must be contained by a ul or ol and receive valid list semantics.",
      who: "Screen-reader users navigating lists.",
      why: "The parent list gives the item its position, count, and relationship to siblings.",
    },
    zh: {
      name: "列表项语义",
      what: "每个 li 都必须包含在 ul 或 ol 中，并正确获得列表语义。",
      who: "使用屏幕阅读器浏览列表的用户。",
      why: "父列表能提供项目的位置、总数及其与同级项目的关系。",
    },
  },
  marquee: {
    en: {
      name: "No marquee elements",
      what: "Do not use the deprecated marquee element.",
      who: "People with motion sensitivity, cognitive disabilities, and screen-reader users.",
      why: "Scrolling marquee content is distracting, difficult to control, and semantically unreliable.",
    },
    zh: {
      name: "不使用 marquee 元素",
      what: "不要使用已弃用的 marquee 元素。",
      who: "对运动敏感、有认知障碍的用户以及屏幕阅读器用户。",
      why: "滚动 marquee 内容难以控制、容易分散注意力，语义也不可靠。",
    },
  },
  "meta-refresh": {
    en: {
      name: "Controllable delayed refresh",
      what: "Do not use a delayed meta refresh under 20 hours without an accessible control or equivalent mechanism.",
      who: "Screen-reader users and people who need more time to read or complete a task.",
      why: "Unexpected navigation interrupts reading and can erase a user's place or work.",
    },
    zh: {
      name: "可控制的延迟刷新",
      what: "不能在没有可访问控制或等效机制时使用 20 小时以内的 meta 延迟刷新。",
      who: "屏幕阅读器用户以及需要更多时间阅读或完成任务的用户。",
      why: "意外跳转会打断阅读，还可能丢失用户的位置或已填写内容。",
    },
  },
  "meta-refresh-no-exceptions": {
    en: {
      name: "No delayed meta refresh",
      what: "Do not use meta refresh to reload or redirect a page after a delay.",
      who: "People who need predictable page state, including screen-reader and cognitive-disability users.",
      why: "Automatic navigation takes control away and can interrupt work without warning.",
    },
    zh: {
      name: "不使用延迟 meta 刷新",
      what: "不要使用 meta refresh 在延迟后重新加载或跳转页面。",
      who: "需要页面状态可预测的用户，包括屏幕阅读器和认知障碍用户。",
      why: "自动跳转会夺走控制权，可能毫无预警地打断操作。",
    },
  },
  "meta-viewport": {
    en: {
      name: "Zoomable viewport",
      what: "The viewport must not disable text scaling or user zooming.",
      who: "People with low vision who enlarge content on mobile devices.",
      why: "Zoom lets users make text and controls large enough to read and operate.",
    },
    zh: {
      name: "可缩放视口",
      what: "viewport 不能禁用文本缩放或用户缩放。",
      who: "在移动设备上放大内容的低视力用户。",
      why: "缩放能让文字和控件达到可阅读、可操作的大小。",
    },
  },
  "meta-viewport-large": {
    en: {
      name: "Sufficient viewport scaling",
      what: "The viewport must allow users to enlarge text by a significant amount, up to 500 percent.",
      who: "People with low vision and users who need large text on small screens.",
      why: "Substantial scaling keeps content readable without requiring a separate page or device.",
    },
    zh: {
      name: "足够的视口缩放",
      what: "viewport 必须允许用户大幅放大文本，最高可达 500%。",
      who: "低视力用户以及在小屏幕上需要大字号的用户。",
      why: "充分缩放能保持内容可读，无需另开页面或更换设备。",
    },
  },
  "nested-interactive": {
    en: {
      name: "No nested interactive controls",
      what: "Do not place one interactive control inside another interactive control.",
      who: "Keyboard and screen-reader users navigating focusable controls.",
      why: "Nested controls create competing focus targets and may be announced incompletely.",
    },
    zh: {
      name: "不嵌套交互控件",
      what: "一个交互控件不能放在另一个交互控件内部。",
      who: "在可聚焦控件间导航的键盘和屏幕阅读器用户。",
      why: "嵌套控件会产生竞争焦点目标，播报也可能不完整。",
    },
  },
  "no-autoplay-audio": {
    en: {
      name: "No unannounced autoplay audio",
      what: "Audio must not play automatically for more than three seconds without a way to stop or mute it.",
      who: "Screen-reader users, people with hearing or attention sensitivities, and anyone in a shared space.",
      why: "Unexpected sound interferes with speech output and removes control from the listener.",
    },
    zh: {
      name: "不自动播放未提示的音频",
      what: "音频不能在没有停止或静音机制时自动播放超过三秒。",
      who: "屏幕阅读器用户、对声音敏感的用户，以及在共享空间使用设备的用户。",
      why: "意外声音会干扰语音播报，并剥夺听者的控制权。",
    },
  },
  "object-alt": {
    en: {
      name: "Object alternative text",
      what: "Every object element needs alternative text for its embedded content.",
      who: "Screen-reader users and people unable to load or perceive the object.",
      why: "A textual alternative preserves the object's purpose when the embedded media is unavailable.",
    },
    zh: {
      name: "object 替代文本",
      what: "每个 object 元素都要为嵌入内容提供替代文本。",
      who: "屏幕阅读器用户以及无法加载或感知该对象的用户。",
      why: "嵌入媒体不可用时，文本替代仍能保留其用途。",
    },
  },
  "p-as-heading": {
    en: {
      name: "Semantic headings",
      what: "Do not style a paragraph to look like a heading instead of using a heading element.",
      who: "Screen-reader users navigating by heading structure.",
      why: "Only a real heading exposes the section hierarchy to assistive technology.",
    },
    zh: {
      name: "语义化标题",
      what: "不要只把段落样式做成标题外观，应使用真正的标题元素。",
      who: "按标题结构导航的屏幕阅读器用户。",
      why: "只有真正的标题元素会把区块层级提供给辅助技术。",
    },
  },
  "page-has-heading-one": {
    en: {
      name: "Level-one page heading",
      what: "The page or one of its frames must contain a level-one heading.",
      who: "Screen-reader users orienting themselves at the start of a document.",
      why: "An h1 identifies the page's primary subject and establishes a useful entry point.",
    },
    zh: {
      name: "一级页面标题",
      what: "页面或其某个 frame 必须包含一级标题。",
      who: "在文档开头定位方向的屏幕阅读器用户。",
      why: "h1 能标识页面主题，并提供清晰的进入点。",
    },
  },
  "presentation-role-conflict": {
    en: {
      name: "Consistent presentation role",
      what: "An element marked presentational must not carry global ARIA or tabindex that makes it meaningful again.",
      who: "Screen-reader users relying on decorative content being ignored.",
      why: "Conflicting semantics can expose decorative nodes as interactive or informative content.",
    },
    zh: {
      name: "一致的 presentation 角色",
      what: "标记为装饰性的元素不能再带有全局 ARIA 或 tabindex，使其重新具有语义。",
      who: "依赖辅助技术忽略装饰内容的屏幕阅读器用户。",
      why: "语义冲突可能把装饰节点错误暴露为交互或信息内容。",
    },
  },
  region: {
    en: {
      name: "Content inside landmarks",
      what: "All meaningful page content should be contained in an appropriate landmark region.",
      who: "Screen-reader users navigating by regions and landmarks.",
      why: "Landmarks divide a page into named areas that are faster to scan and revisit.",
    },
    zh: {
      name: "地标内的页面内容",
      what: "所有有意义的页面内容都应包含在适当的地标区域中。",
      who: "按区域和地标导航的屏幕阅读器用户。",
      why: "地标把页面划分为可命名区域，便于快速扫描和再次定位。",
    },
  },
  "role-img-alt": {
    en: {
      name: "Alternative text for role=img",
      what: "Elements with role=img or role=image must expose alternative text.",
      who: "Screen-reader users encountering an image represented by a generic element.",
      why: "The name conveys the image's information when the visual representation is unavailable.",
    },
    zh: {
      name: "role=img 的替代文本",
      what: "带有 role=img 或 role=image 的元素必须提供替代文本。",
      who: "遇到由通用元素表示图像的屏幕阅读器用户。",
      why: "视觉图像不可用时，名称仍能传达图像信息。",
    },
  },
  "scope-attr-valid": {
    en: {
      name: "Correct table scope",
      what: "Use the scope attribute only with a valid table-header relationship.",
      who: "Screen-reader users reading table headers and data cells.",
      why: "Correct scope connects each header to the cells it describes.",
    },
    zh: {
      name: "正确的表格 scope",
      what: "scope 属性只能用于有效的表头关联关系。",
      who: "使用屏幕阅读器阅读表头和数据单元格的用户。",
      why: "正确的 scope 能把表头连接到它所说明的单元格。",
    },
  },
  "scrollable-region-focusable": {
    en: {
      name: "Keyboard access to scrollable regions",
      what: "A region with scrollable content must have a keyboard-accessible way to scroll it in Safari.",
      who: "Keyboard users and people who cannot use a precision pointer.",
      why: "Keyboard access prevents content from being trapped outside the visible viewport.",
    },
    zh: {
      name: "可滚动区域的键盘访问",
      what: "包含可滚动内容的区域必须在 Safari 中提供键盘滚动方式。",
      who: "键盘用户以及无法使用精确指针操作的用户。",
      why: "键盘访问能避免内容被困在可视区域之外。",
    },
  },
  "select-name": {
    en: {
      name: "Select accessible name",
      what: "Every select element needs an accessible name.",
      who: "Screen-reader and voice-control users choosing a form option.",
      why: "The name identifies what the select controls before users open its options.",
    },
    zh: {
      name: "select 可访问名称",
      what: "每个 select 元素都必须有可访问名称。",
      who: "使用屏幕阅读器或语音控制选择表单选项的用户。",
      why: "名称能在用户打开选项前说明该下拉控件控制什么。",
    },
  },
  "server-side-image-map": {
    en: {
      name: "No server-side image maps",
      what: "Do not use a server-side image map for pointer-based choices.",
      who: "Keyboard users and people who cannot accurately point at image coordinates.",
      why: "Coordinate-only interaction has no operable keyboard equivalent or meaningful target names.",
    },
    zh: {
      name: "不使用服务器端图像映射",
      what: "不要用服务器端图像映射承载依赖指针坐标的选择。",
      who: "键盘用户以及无法精确指向图像坐标的用户。",
      why: "仅靠坐标的交互没有可操作的键盘等价方式，也没有有意义的目标名称。",
    },
  },
  "skip-link": {
    en: {
      name: "Focusable skip-link target",
      what: "Every skip link must point to an existing, focusable target.",
      who: "Keyboard and screen-reader users skipping repeated page content.",
      why: "A valid target moves focus as well as the reading position to the intended content.",
    },
    zh: {
      name: "可聚焦的跳过链接目标",
      what: "每个跳过链接都必须指向存在且可聚焦的目标。",
      who: "跳过重复页面内容的键盘和屏幕阅读器用户。",
      why: "有效目标能同时移动焦点和阅读位置，直达指定内容。",
    },
  },
  "summary-name": {
    en: {
      name: "Summary accessible name",
      what: "Every summary element must expose discernible text.",
      who: "Screen-reader users expanding and collapsing disclosure content.",
      why: "The summary tells users what content the disclosure controls.",
    },
    zh: {
      name: "summary 可访问名称",
      what: "每个 summary 元素都必须提供可辨识文本。",
      who: "使用屏幕阅读器展开和收起详情内容的用户。",
      why: "summary 能说明该折叠控件控制的内容。",
    },
  },
  "svg-img-alt": {
    en: {
      name: "SVG image alternative text",
      what: "An SVG used with an image role must expose accessible text.",
      who: "Screen-reader users encountering SVG icons or illustrations.",
      why: "Text gives the SVG a meaningful purpose when its visual shapes are not perceived.",
    },
    zh: {
      name: "SVG 图像替代文本",
      what: "使用图像角色的 SVG 必须提供可访问文本。",
      who: "遇到 SVG 图标或插图的屏幕阅读器用户。",
      why: "当用户无法感知图形时，文本仍能说明 SVG 的用途。",
    },
  },
  tabindex: {
    en: {
      name: "Non-positive tabindex",
      what: "Do not set tabindex to a value greater than zero.",
      who: "Keyboard users moving through a predictable focus order.",
      why: "Positive tabindex values override document order and create a confusing path through controls.",
    },
    zh: {
      name: "非正 tabindex",
      what: "不要把 tabindex 设置为大于零的值。",
      who: "按可预测焦点顺序操作页面的键盘用户。",
      why: "正 tabindex 会改写文档顺序，让控件导航路径难以理解。",
    },
  },
  "table-duplicate-name": {
    en: {
      name: "Distinct table caption and summary",
      what: "A table's caption must not repeat the text of its summary attribute.",
      who: "Screen-reader users hearing table context before reading its cells.",
      why: "Different context and summary text avoids redundant announcements and adds useful information.",
    },
    zh: {
      name: "表格 caption 与 summary 不重复",
      what: "表格 caption 元素不能重复 summary 属性的文字。",
      who: "在读取单元格前听取表格说明的屏幕阅读器用户。",
      why: "两者提供不同信息可以避免重复播报并增加上下文。",
    },
  },
  "table-fake-caption": {
    en: {
      name: "Real table captions",
      what: "Use a caption element to caption a data table instead of a data or header cell.",
      who: "Screen-reader users identifying a table before navigating its cells.",
      why: "The caption is announced as table context and is not confused with cell data.",
    },
    zh: {
      name: "真正的表格标题",
      what: "数据表应使用 caption 元素作标题，不能用数据单元格或表头单元格冒充。",
      who: "在浏览单元格前识别表格的屏幕阅读器用户。",
      why: "caption 会作为表格上下文播报，不会被误认为单元格数据。",
    },
  },
  "target-size": {
    en: {
      name: "Touch target size and spacing",
      what: "Touch targets must be at least 24 CSS pixels or have sufficient separation from neighbors.",
      who: "Touch users, people with limited dexterity, and users on small screens.",
      why: "Adequate size and spacing reduce accidental activation of the wrong control.",
    },
    zh: {
      name: "触摸目标大小与间距",
      what: "触摸目标至少应为 24 CSS 像素，或与相邻目标保持足够间距。",
      who: "触摸用户、手部精细动作受限的用户以及小屏幕用户。",
      why: "足够的大小和间距能减少误触相邻控件。",
    },
  },
  "td-has-header": {
    en: {
      name: "Headers for data cells",
      what: "Each non-empty data cell in a table larger than 3 by 3 needs an associated header.",
      who: "Screen-reader users reading a large data table by row and column.",
      why: "The header identifies the meaning of each value as users move through cells.",
    },
    zh: {
      name: "数据单元格关联表头",
      what: "大于 3×3 的表格中，每个非空数据单元格都要关联一个或多个表头。",
      who: "按行列使用屏幕阅读器阅读大型数据表的用户。",
      why: "表头能在用户移动到单元格时说明数值含义。",
    },
  },
  "td-headers-attr": {
    en: {
      name: "Valid table headers references",
      what: "Each headers attribute on a table cell must reference only th elements in the same table.",
      who: "Screen-reader users relying on explicit cell-to-header associations.",
      why: "Same-table references prevent a cell from inheriting an unrelated or missing header.",
    },
    zh: {
      name: "有效的表格 headers 引用",
      what: "表格单元格的 headers 属性只能引用同一表格中的 th 元素。",
      who: "依赖单元格与表头显式关联的屏幕阅读器用户。",
      why: "同表引用能避免单元格关联到无关或不存在的表头。",
    },
  },
  "th-has-data-cells": {
    en: {
      name: "Headers describe data cells",
      what: "Each data-table header must have data cells that it describes.",
      who: "Screen-reader users navigating table headers and their values.",
      why: "A header without data is noise, while a connected header explains the table's dimensions.",
    },
    zh: {
      name: "表头关联数据单元格",
      what: "数据表中的每个表头都必须有它所说明的数据单元格。",
      who: "在表头与数值之间导航的屏幕阅读器用户。",
      why: "没有数据的表头会造成噪音，有关联的表头才能说明表格维度。",
    },
  },
  "valid-lang": {
    en: {
      name: "Valid language attributes",
      what: "Every lang attribute must use a valid BCP 47 language tag.",
      who: "Screen-reader users and browser features that choose pronunciation by language.",
      why: "Valid tags allow software to apply the correct voice and text-processing rules.",
    },
    zh: {
      name: "有效的语言属性",
      what: "每个 lang 属性都必须使用有效的 BCP 47 语言标签。",
      who: "使用屏幕阅读器及依语言选择发音的浏览器功能的用户。",
      why: "有效标签能让软件采用正确的语音和文本处理规则。",
    },
  },
  "video-caption": {
    en: {
      name: "Video captions",
      what: "Every video with spoken or meaningful audio needs synchronized captions.",
      who: "Deaf or hard-of-hearing users and people watching without sound.",
      why: "Captions provide dialogue and important sound information in text form.",
    },
    zh: {
      name: "视频字幕",
      what: "包含语音或重要音频的视频都需要同步字幕。",
      who: "聋人、听力障碍用户以及静音观看视频的用户。",
      why: "字幕以文字提供对话和重要声音信息。",
    },
  },
};
