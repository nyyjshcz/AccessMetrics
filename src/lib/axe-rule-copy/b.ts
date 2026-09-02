import type { StaticAxeRuleCopy } from "./types";

export const RULE_COPY_B: Record<string, StaticAxeRuleCopy> = {
  "css-orientation-lock": {
    en: {
      name: "CSS orientation lock",
      what: "CSS media queries must not force the page to one display orientation when the content can work in both portrait and landscape.",
      who: "People who mount a device in a fixed position, use a wheelchair, or need to choose the orientation that is easiest to see and operate.",
      why: "A forced orientation can make controls unreachable or require users to physically rotate a device they cannot conveniently turn.",
    },
    zh: {
      name: "CSS 屏幕方向锁定",
      what: "CSS 媒体查询不应在内容能够同时适配竖屏和横屏时强制页面只能使用一种方向。",
      who: "将设备固定在支架上、使用轮椅，或需要选择更易查看和操作方向的用户。",
      why: "锁定屏幕方向可能让控件无法访问，也可能要求无法方便转动设备的用户旋转设备。",
    },
  },
  "definition-list": {
    en: {
      name: "Definition-list structure",
      what: "Each <dl> must directly contain properly ordered groups of <dt> terms and <dd> descriptions, with only permitted grouping elements between them.",
      who: "People who navigate structured content with a screen reader or other semantic browsing tool.",
      why: "Correct term-and-description relationships let assistive technology announce a definition list as a coherent pair instead of unrelated text.",
    },
    zh: {
      name: "定义列表结构",
      what: "每个 <dl> 都应直接包含顺序正确的 <dt> 术语和 <dd> 描述组，中间只能使用规范允许的分组元素。",
      who: "使用屏幕阅读器或其他语义浏览工具浏览结构化内容的用户。",
      why: "正确的术语与描述关系能让辅助技术把定义列表作为完整配对内容播报，而不是一段段互不相关的文字。",
    },
  },
  dlitem: {
    en: {
      name: "Definition-list item parent",
      what: "Every <dt> term and <dd> description must be contained by a <dl> definition list.",
      who: "People who rely on a screen reader to understand relationships between terms and their explanations.",
      why: "A definition item outside a <dl> loses the semantic context that identifies what is being defined and what explains it.",
    },
    zh: {
      name: "定义列表项的父级",
      what: "每个 <dt> 术语和 <dd> 描述都必须位于 <dl> 定义列表中。",
      who: "依靠屏幕阅读器理解术语与解释之间关系的用户。",
      why: "定义列表项脱离 <dl> 后会失去表明“被定义内容”和“对应解释”的语义上下文。",
    },
  },
  "document-title": {
    en: {
      name: "Document title",
      what: "Every HTML document must contain a non-empty <title> element that describes the page.",
      who: "People who identify pages through browser tabs, history, bookmarks, window lists, or screen-reader document commands.",
      why: "A meaningful title makes it possible to distinguish pages without opening them and provides an immediate orientation when a document loads.",
    },
    zh: {
      name: "文档标题",
      what: "每个 HTML 文档都必须包含非空的 <title> 元素，用来描述当前页面。",
      who: "通过浏览器标签页、历史记录、书签、窗口列表或屏幕阅读器文档命令识别页面的用户。",
      why: "有意义的标题让用户无需打开页面就能区分它们，并在文档加载时立即获得定位信息。",
    },
  },
  "duplicate-id": {
    en: {
      name: "Unique HTML IDs",
      what: "Every id attribute value must occur only once in the document.",
      who: "All users, especially people using keyboard navigation, assistive technology, or scripts that target a specific element.",
      why: "Duplicate IDs make DOM references ambiguous and can send focus, labels, links, or scripts to the wrong element.",
    },
    zh: {
      name: "HTML ID 唯一性",
      what: "文档中的每个 id 属性值都只能出现一次。",
      who: "所有用户，尤其是使用键盘导航、辅助技术或依靠脚本定位特定元素的用户。",
      why: "重复 ID 会使 DOM 引用产生歧义，可能让焦点、标签、链接或脚本指向错误的元素。",
    },
  },
  "duplicate-id-active": {
    en: {
      name: "Unique IDs on active elements",
      what: "Every id value assigned to an active element must be unique among the active elements in the document.",
      who: "Keyboard and switch users who move through interactive controls, as well as assistive technology users following element references.",
      why: "Repeated IDs on interactive elements can make navigation and programmatic activation target an unpredictable control.",
    },
    zh: {
      name: "活动元素的 ID 唯一性",
      what: "分配给活动元素的每个 ID 值，在文档的活动元素中都必须唯一。",
      who: "使用键盘或开关设备浏览交互控件，以及通过元素引用操作页面的辅助技术用户。",
      why: "交互元素使用重复 ID 时，导航和程序化激活可能指向无法预测的控件。",
    },
  },
  "duplicate-id-aria": {
    en: {
      name: "Unique IDs used by ARIA and labels",
      what: "Each ID referenced by ARIA attributes or form-label relationships must identify one element only.",
      who: "Screen-reader users and anyone who depends on correctly associated form labels, descriptions, or relationships.",
      why: "A duplicated target can cause assistive technology to announce the wrong name, description, state, or relationship.",
    },
    zh: {
      name: "ARIA 与标签引用的 ID 唯一性",
      what: "ARIA 属性或表单标签关系所引用的每个 ID 都只能对应一个元素。",
      who: "使用屏幕阅读器，以及依赖正确表单标签、描述和语义关系的用户。",
      why: "引用目标重复时，辅助技术可能播报错误的名称、描述、状态或关联关系。",
    },
  },
  "empty-heading": {
    en: {
      name: "Non-empty headings",
      what: "Every heading element must expose discernible text rather than an empty heading level.",
      who: "Screen-reader users who scan a page by its heading outline.",
      why: "An empty heading adds a meaningless stop to the outline and hides the structure or topic that users expect to find there.",
    },
    zh: {
      name: "标题不可为空",
      what: "每个标题元素都必须提供可识别的文本，不能只留下空的标题层级。",
      who: "通过页面标题大纲快速浏览内容的屏幕阅读器用户。",
      why: "空标题会在大纲中增加没有意义的停留点，并让用户无法知道该位置代表的结构或主题。",
    },
  },
  "empty-table-header": {
    en: {
      name: "Non-empty table headers",
      what: "Every table header cell must have discernible header text.",
      who: "Screen-reader users who hear a cell's row and column headers while navigating a data table.",
      why: "Without header text, users cannot tell what a column or row represents when the table is read cell by cell.",
    },
    zh: {
      name: "表头不可为空",
      what: "每个表头单元格都必须包含可识别的表头文本。",
      who: "在数据表中逐格导航、需要听到行列表头的屏幕阅读器用户。",
      why: "没有表头文本时，用户无法在逐格读取表格时判断某列或某行代表什么。",
    },
  },
  "focus-order-semantics": {
    en: {
      name: "Semantic roles in the focus order",
      what: "Elements placed in the keyboard focus order must have a role appropriate for interactive content.",
      who: "Keyboard-only users and assistive technologies that build a list of interactive controls.",
      why: "A focusable element without a suitable role gives users a stop that has no understandable control semantics or expected interaction.",
    },
    zh: {
      name: "焦点顺序中的语义角色",
      what: "加入键盘焦点顺序的元素必须具有适合交互内容的语义角色。",
      who: "仅使用键盘的用户，以及为用户整理交互控件列表的辅助技术。",
      why: "可聚焦元素缺少合适角色时，用户会遇到没有明确控件含义或交互方式的焦点停留点。",
    },
  },
  "form-field-multiple-labels": {
    en: {
      name: "One label per form field",
      what: "A form field must not be associated with multiple <label> elements.",
      who: "Screen-reader users and people using speech input to identify and operate form fields.",
      why: "Multiple labels can produce repetitive or conflicting announcements and make speech commands ambiguous.",
    },
    zh: {
      name: "每个表单字段使用一个标签",
      what: "一个表单字段不应关联多个 <label> 元素。",
      who: "使用屏幕阅读器，或通过语音输入识别和操作表单字段的用户。",
      why: "多个标签可能造成重复或相互冲突的播报，也会让语音命令变得含糊。",
    },
  },
  "frame-focusable-content": {
    en: {
      name: "Focusable content in frames",
      what: "A <frame> or <iframe> that contains focusable content must not itself be removed from the keyboard focus order with tabindex=-1.",
      who: "Keyboard users and screen-reader users entering embedded documents.",
      why: "Removing the frame from focus can strand users from its controls or make an embedded document impossible to reach predictably.",
    },
    zh: {
      name: "框架中的可聚焦内容",
      what: "包含可聚焦内容的 <frame> 或 <iframe> 不得通过 tabindex=-1 将自身移出键盘焦点顺序。",
      who: "使用键盘以及需要进入嵌入文档的屏幕阅读器用户。",
      why: "移除框架焦点可能让用户无法到达其中的控件，或无法可靠地进入嵌入文档。",
    },
  },
  "frame-tested": {
    en: {
      name: "Frames tested with axe-core",
      what: "Each <iframe> and <frame> should contain the axe-core script so its embedded document can be checked.",
      who: "Accessibility testers and users whose experience depends on defects inside embedded documents being found.",
      why: "An untested frame can hide accessibility failures from the scan and leave a substantial part of the experience unreviewed.",
    },
    zh: {
      name: "使用 axe-core 检查框架",
      what: "每个 <iframe> 和 <frame> 都应包含 axe-core 脚本，以便检查其中的嵌入文档。",
      who: "无障碍测试人员，以及依赖嵌入文档缺陷被发现的用户。",
      why: "未检查的框架可能把无障碍问题隐藏在扫描结果之外，导致重要的页面体验没有经过审核。",
    },
  },
  "frame-title": {
    en: {
      name: "Accessible frame name",
      what: "Every <iframe> and <frame> must expose an accessible name, normally through a meaningful title attribute.",
      who: "Screen-reader users who decide whether to enter an embedded document and what it contains.",
      why: "A name identifies the frame's purpose before a user enters it, preventing unexplained context changes.",
    },
    zh: {
      name: "框架的可访问名称",
      what: "每个 <iframe> 和 <frame> 都必须提供可访问名称，通常使用有意义的 title 属性。",
      who: "需要判断是否进入嵌入文档及其内容的屏幕阅读器用户。",
      why: "名称能在用户进入框架前说明其用途，避免出现没有解释的上下文切换。",
    },
  },
  "frame-title-unique": {
    en: {
      name: "Unique frame titles",
      what: "Each <iframe> and <frame> must have a title attribute that is unique among the frames on the page.",
      who: "Screen-reader users who navigate between embedded documents by their frame titles.",
      why: "Distinct titles let users select the intended frame without opening several indistinguishable embedded contexts.",
    },
    zh: {
      name: "框架标题唯一",
      what: "每个 <iframe> 和 <frame> 的 title 属性都必须在页面框架之间保持唯一。",
      who: "通过框架标题在多个嵌入文档之间导航的屏幕阅读器用户。",
      why: "不同的标题让用户能够选择目标框架，而不必在几个无法区分的嵌入上下文之间反复尝试。",
    },
  },
  "heading-order": {
    en: {
      name: "Logical heading order",
      what: "Heading levels should follow the document hierarchy and increase by no more than one level at a time.",
      who: "Screen-reader users who use heading navigation to understand and move through page sections.",
      why: "A skipped heading level obscures parent-child structure and makes the page outline harder to predict.",
    },
    zh: {
      name: "合乎逻辑的标题顺序",
      what: "标题层级应遵循文档结构，并且每次最多只增加一级。",
      who: "通过标题导航理解页面结构并在各个章节之间移动的屏幕阅读器用户。",
      why: "跳过标题层级会掩盖父子结构，让页面大纲更难理解和预测。",
    },
  },
  "hidden-content": {
    en: {
      name: "Review hidden content",
      what: "Content hidden by CSS or other mechanisms should be reviewed so that intentionally hidden and accidentally hidden content are distinguished.",
      who: "Accessibility reviewers and users who may encounter content through assistive technology, search, or responsive states.",
      why: "Hidden text can either be a deliberate accessible enhancement or an accidental loss of information; reviewing it prevents both false confidence and missed content.",
    },
    zh: {
      name: "审核隐藏内容",
      what: "应审核通过 CSS 或其他机制隐藏的内容，区分有意隐藏与意外隐藏的内容。",
      who: "无障碍审核人员，以及可能通过辅助技术、搜索或响应式状态接触这些内容的用户。",
      why: "隐藏文本可能是有意提供的无障碍增强，也可能意味着信息意外丢失；审核可以避免误判和漏检。",
    },
  },
  "html-has-lang": {
    en: {
      name: "HTML language declaration",
      what: "The root <html> element must include a lang attribute declaring the document's primary language.",
      who: "Screen-reader users, translation-tool users, and people who depend on language-aware text processing.",
      why: "The language declaration enables correct pronunciation, voice selection, hyphenation, translation, and other language-specific behavior.",
    },
    zh: {
      name: "HTML 语言声明",
      what: "根 <html> 元素必须包含 lang 属性，用来声明文档的主要语言。",
      who: "使用屏幕阅读器、翻译工具，以及依赖语言识别文本处理的用户。",
      why: "语言声明有助于选择正确的发音和语音、断词方式、翻译规则及其他语言相关行为。",
    },
  },
  "html-lang-valid": {
    en: {
      name: "Valid HTML language value",
      what: "The <html> element's lang attribute must use a valid BCP 47 language tag.",
      who: "Screen-reader and translation-tool users whose software selects language behavior from the document metadata.",
      why: "An invalid tag prevents software from reliably choosing the correct pronunciation, voice, or translation language.",
    },
    zh: {
      name: "有效的 HTML 语言值",
      what: "<html> 元素的 lang 属性必须使用有效的 BCP 47 语言标签。",
      who: "依靠文档元数据选择语言行为的屏幕阅读器和翻译工具用户。",
      why: "无效标签会使软件无法可靠地选择正确的发音、语音或翻译语言。",
    },
  },
  "html-xml-lang-mismatch": {
    en: {
      name: "Matching HTML and XML languages",
      what: "When an HTML element has valid lang and xml:lang attributes, their base languages must agree.",
      who: "Users of screen readers, speech synthesis, translation tools, and other language-sensitive software.",
      why: "Conflicting language metadata can make different tools choose different pronunciation or translation rules for the same content.",
    },
    zh: {
      name: "HTML 与 XML 语言一致",
      what: "HTML 元素同时具有有效的 lang 和 xml:lang 属性时，两者的基础语言必须一致。",
      who: "使用屏幕阅读器、语音合成、翻译工具及其他语言敏感软件的用户。",
      why: "相互冲突的语言元数据会让不同工具为同一内容选择不同的发音或翻译规则。",
    },
  },
  "identical-links-same-purpose": {
    en: {
      name: "Same purpose for identically named links",
      what: "Links with the same accessible name must lead to destinations or actions with a similar purpose.",
      who: "Screen-reader users who navigate by a list of link names without seeing each link's surrounding context.",
      why: "Identical names for different purposes force users to guess which link is correct and can lead them to the wrong destination.",
    },
    zh: {
      name: "同名链接具有相同目的",
      what: "具有相同可访问名称的链接必须指向目的相近的目标，或执行目的相近的操作。",
      who: "通过链接名称列表导航、无法看到每个链接周围上下文的屏幕阅读器用户。",
      why: "不同目的使用相同名称会迫使用户猜测正确链接，并可能把用户带到错误目标。",
    },
  },
  "image-alt": {
    en: {
      name: "Alternative text for images",
      what: "Every informative <img> must have appropriate alternative text; purely decorative images must be explicitly marked decorative.",
      who: "People who are blind or have low vision, users with images disabled, and anyone who cannot perceive the image itself.",
      why: "Alternative text conveys the image's information or purpose when the visual cannot be seen.",
    },
    zh: {
      name: "图像替代文本",
      what: "每个传达信息的 <img> 都必须有合适的替代文本；纯装饰图像则应明确标记为装饰性内容。",
      who: "盲人或低视力用户、禁用图像的用户，以及无法直接感知图像的用户。",
      why: "当用户无法看到图像时，替代文本能够传达图像承载的信息或用途。",
    },
  },
  "image-redundant-alt": {
    en: {
      name: "Avoid redundant image alternative text",
      what: "An image's alternative text should not repeat text that is already presented immediately alongside the image.",
      who: "Screen-reader users who hear nearby visible text and the image alternative text in sequence.",
      why: "Repeating the same words makes content verbose and obscures the meaningful information the image adds.",
    },
    zh: {
      name: "避免重复图像替代文本",
      what: "图像的替代文本不应重复图像旁边已经显示的文字。",
      who: "会依次听到相邻可见文字和图像替代文本的屏幕阅读器用户。",
      why: "重复播报会让内容冗长，并掩盖图像真正补充的有用信息。",
    },
  },
  "input-button-name": {
    en: {
      name: "Name for input buttons",
      what: "Every input control that submits, resets, or triggers an action must expose discernible text describing that action.",
      who: "Screen-reader users and people using voice control to identify and activate form buttons.",
      why: "A clear button name tells users what will happen before they activate the control.",
    },
    zh: {
      name: "输入按钮名称",
      what: "每个用于提交、重置或触发操作的 input 控件都必须提供描述该操作的可识别文本。",
      who: "使用屏幕阅读器或语音控制识别和激活表单按钮的用户。",
      why: "清晰的按钮名称能让用户在激活控件前知道将要发生什么。",
    },
  },
  "input-image-alt": {
    en: {
      name: "Alternative text for image inputs",
      what: 'Every <input type="image"> must have alternative text that identifies the action performed by the image button.',
      who: "Screen-reader users and people who cannot see the image used as a form submission control.",
      why: "The alternative text supplies the button's name and action when its visual appearance is unavailable.",
    },
    zh: {
      name: "图像输入控件的替代文本",
      what: '每个 <input type="image"> 都必须有替代文本，说明这个图像按钮执行的操作。',
      who: "使用屏幕阅读器，或无法看到作为表单提交控件的图像的用户。",
      why: "当用户无法看到视觉外观时，替代文本会提供按钮名称和操作信息。",
    },
  },
  label: {
    en: {
      name: "Labels for form elements",
      what: "Every form control that requires a user decision or input must have a programmatically associated label.",
      who: "Screen-reader users, voice-control users, and people who need a larger clickable label target.",
      why: "A label identifies a control, gives it an accessible name, and lets users understand what information or choice it requests.",
    },
    zh: {
      name: "表单元素标签",
      what: "每个需要用户做决定或输入内容的表单控件都必须有程序化关联的标签。",
      who: "使用屏幕阅读器、语音控制，以及需要更大可点击标签区域的用户。",
      why: "标签能够识别控件、提供可访问名称，并说明控件要求填写或选择的信息。",
    },
  },
  "label-content-name-mismatch": {
    en: {
      name: "Visible text in accessible names",
      what: "For an element labelled by its visible content, that visible text must be included in its accessible name.",
      who: "People using speech input, who repeat the words they can see to activate a control.",
      why: "When the spoken visible label is absent from the accessible name, voice commands may fail or activate the wrong control.",
    },
    zh: {
      name: "可访问名称包含可见文字",
      what: "通过可见内容获得标签的元素，其可访问名称必须包含该可见文字。",
      who: "使用语音输入、通过复述屏幕上可见文字来激活控件的用户。",
      why: "可见标签没有出现在可访问名称中时，语音命令可能无法执行，或会激活错误控件。",
    },
  },
  "label-title-only": {
    en: {
      name: "Visible labels for form fields",
      what: "A form field should have a visible <label> and should not be identified only by a hidden label, title, or aria-describedby text.",
      who: "People with cognitive or memory disabilities, low-vision users, and anyone scanning the form visually.",
      why: "A persistent visible label keeps the field's purpose clear while users fill it in, review it, or return to it later.",
    },
    zh: {
      name: "表单字段的可见标签",
      what: "表单字段应有可见的 <label>，不能只依靠隐藏标签、title 或 aria-describedby 文本来识别。",
      who: "有认知或记忆障碍的用户、低视力用户，以及通过视觉浏览表单的用户。",
      why: "持续可见的标签能让用户在填写、检查或稍后返回字段时始终清楚其用途。",
    },
  },
  "landmark-banner-is-top-level": {
    en: {
      name: "Top-level banner landmark",
      what: "The page's banner landmark must not be nested inside another landmark region.",
      who: "Screen-reader users who navigate the page by landmark regions.",
      why: "A top-level banner gives the document header a predictable place in the landmark map instead of making it appear subordinate to another region.",
    },
    zh: {
      name: "顶层 banner 地标",
      what: "页面的 banner 地标不应嵌套在另一个地标区域内。",
      who: "通过地标区域导航页面的屏幕阅读器用户。",
      why: "顶层 banner 能让文档页眉在地标地图中拥有可预测的位置，而不是看起来从属于另一个区域。",
    },
  },
  "landmark-complementary-is-top-level": {
    en: {
      name: "Top-level complementary landmark",
      what: "A complementary landmark or <aside> should not be nested inside another landmark region.",
      who: "Screen-reader users who jump between navigation landmarks to find related or supporting content.",
      why: "Keeping an aside at the top level makes the supporting section discoverable as an independent region.",
    },
    zh: {
      name: "顶层 complementary 地标",
      what: "complementary 地标或 <aside> 不应嵌套在另一个地标区域内。",
      who: "通过地标导航寻找相关或辅助内容的屏幕阅读器用户。",
      why: "让 aside 保持顶层，能使辅助内容区域作为独立区域被发现和定位。",
    },
  },
  "landmark-contentinfo-is-top-level": {
    en: {
      name: "Top-level contentinfo landmark",
      what: "The contentinfo landmark, normally the page footer, must not be contained by another landmark.",
      who: "Screen-reader users who navigate directly to the document footer or site-wide information.",
      why: "A top-level footer is easier to locate and is not misleadingly presented as part of an unrelated section.",
    },
    zh: {
      name: "顶层 contentinfo 地标",
      what: "contentinfo 地标（通常是页面页脚）不应包含在另一个地标中。",
      who: "需要直接导航到文档页脚或站点级信息的屏幕阅读器用户。",
      why: "顶层页脚更容易定位，也不会被误认为属于某个无关的页面章节。",
    },
  },
  "landmark-main-is-top-level": {
    en: {
      name: "Top-level main landmark",
      what: "The main landmark must not be nested inside another landmark region.",
      who: "Screen-reader users who use landmark navigation to jump to the primary page content.",
      why: "A top-level main region provides a reliable destination for bypassing repeated navigation and reaching the page's central content.",
    },
    zh: {
      name: "顶层 main 地标",
      what: "main 地标不应嵌套在另一个地标区域内。",
      who: "通过地标导航跳转到页面主要内容的屏幕阅读器用户。",
      why: "顶层 main 为跳过重复导航、直达页面核心内容提供可靠目标。",
    },
  },
  "landmark-no-duplicate-banner": {
    en: {
      name: "No duplicate banner landmarks",
      what: "A document should have no more than one banner landmark.",
      who: "Screen-reader users who expect each landmark type to identify one predictable page region.",
      why: "Duplicate banners make the landmark list ambiguous and force users to inspect multiple regions that all sound like the page header.",
    },
    zh: {
      name: "不得重复 banner 地标",
      what: "一个文档最多只能有一个 banner 地标。",
      who: "希望每种地标类型都对应一个可预测页面区域的屏幕阅读器用户。",
      why: "重复 banner 会让地标列表产生歧义，用户必须检查多个听起来都像页面页眉的区域。",
    },
  },
  "landmark-no-duplicate-contentinfo": {
    en: {
      name: "No duplicate contentinfo landmarks",
      what: "A document should have no more than one contentinfo landmark.",
      who: "Screen-reader users who use landmark navigation to find site-wide footer information.",
      why: "A single contentinfo landmark gives the footer a stable identity and avoids several indistinguishable footer destinations.",
    },
    zh: {
      name: "不得重复 contentinfo 地标",
      what: "一个文档最多只能有一个 contentinfo 地标。",
      who: "通过地标导航查找站点级页脚信息的屏幕阅读器用户。",
      why: "唯一的 contentinfo 地标能让页脚拥有稳定身份，避免出现多个无法区分的页脚目标。",
    },
  },
  "landmark-no-duplicate-main": {
    en: {
      name: "No duplicate main landmarks",
      what: "A document should have no more than one main landmark.",
      who: "Screen-reader users who jump to the main landmark to reach the primary content.",
      why: "More than one main region removes the single reliable entry point users depend on to bypass repeated page chrome.",
    },
    zh: {
      name: "不得重复 main 地标",
      what: "一个文档最多只能有一个 main 地标。",
      who: "跳转到 main 地标以进入页面主要内容的屏幕阅读器用户。",
      why: "多个 main 区域会破坏用户依赖的唯一入口，使跳过重复页面框架变得不可靠。",
    },
  },
};
