# accesscheck-score-v1 模型说明

正式主模型使用四个 WCAG 原则的加权缺陷率：可感知 40%、可操作 30%、易理解 20%、兼容性 10%。每个违反节点按 `critical=4、serious=3、moderate=2、minor=1` 累加；通过和不适用不扣分，incomplete 单独披露但不扣分。页面和网站均保存整数分子/分母，展示分数只保留一位小数并采用 half-up 舍入。

规则标签解析、严重程度来源、frame 覆盖和抽样边界必须与扫描快照一起导出。此文件是方法说明，不包含正式研究结果；正式结果必须引用冻结的 `model-decision-record.md` 和真实数据观察。
