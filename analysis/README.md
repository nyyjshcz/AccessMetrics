# 研究分析入口

`reference_score.py` 是独立于 TypeScript 的精确评分参考实现；`analyze.py` 只读取已校验 `manifest.json`/`manifest.sha256` 的冻结导出，输出固定 `report-data-v1`、未舍入分数、四项分数、严重程度/常见规则、三套权重敏感性、人工样本范围说明、可追溯图表和数据表。它不会联网，也不会把 fixture 当正式研究结论。

正式运行：

```bash
pnpm analysis:run -- "<绝对路径>/data/exports/<verified-export>"
```

输出位于 `analysis/outputs/`（该目录已 gitignore），包含 `report-data.json`、`charts/site-scores.png` 和 `tables/site-scores.json`。所有数字都绑定输入 manifest/hash；`incomplete` 与未执行 frame 会单独披露，人工样本统计只解释样本内结果。

`analysis:run` 同时保存 `accesscheck_analysis.executed.ipynb`。有 Jupyter/nbconvert 时使用其执行器；本地没有 Jupyter 时使用仓库内的标准库 runner 执行同一组 Python cells，并在异常时失败，不会静默跳过 notebook。
