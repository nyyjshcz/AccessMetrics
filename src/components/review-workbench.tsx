"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Verdict = "confirmed" | "not_an_issue" | "uncertain";

type NodeReview = {
  id: string;
  verdict: Verdict;
  note: string;
  revision: number;
  reviewedAt: string;
};

type Node = {
  resultNodeId: string;
  ordinal: number;
  target: unknown;
  html: string;
  failureSummary: string | null;
  framePath: unknown;
  frameUrl: string | null;
  frameOriginRelation: string | null;
  targetHash: string | null;
  effectiveImpact: string | null;
  currentReview: NodeReview | null;
};

type Finding = {
  id: string;
  resultType: "violation" | "incomplete";
  impact: string | null;
  ruleId: string;
  description: string;
  help: string;
  helpUrl: string;
  pageId: string;
  pageUrl: string;
  pageTitle: string | null;
  nodeCount: number;
  reviewedNodeCount: number;
  currentReviewerReviewedNodeCount: number;
  representativeNodes: Node[];
  priority: boolean;
};

type Workbench = {
  canReview: boolean;
  role: string;
  localizations: Record<
    string,
    { zhName: string; zhFix: string; manualCheck: string; translationStatus: string }
  >;
  summary: {
    automaticNodeCount: number;
    findingCount: number;
    contextNodeCount: number;
    contextFindingCount: number;
    prioritySampleCount: number;
    dailyReviewedFindingCount: number;
    dailyRemainingFindingCount: number;
    dailyReviewedNodeCount: number;
    formalReview: { maxSamplesPerReviewer: number; reviewerCount: number };
  };
  findings: Finding[];
  prioritySamples: Array<Finding & { node: Node }>;
  manualSelection: (Finding & { node: Node }) | null;
};

const getCookie = (name: string) =>
  document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&")}=([^;]+)`),
  )?.[1] ?? "";

const verdictLabel: Record<Verdict, string> = {
  confirmed: "确认：这个节点确实存在无障碍问题",
  not_an_issue: "不成立：这个节点在当前页面不构成问题",
  uncertain: "暂不确定：需要真实辅助技术或业务语境确认",
};

const resultLabel = (type: Finding["resultType"]) =>
  type === "incomplete" ? "待上下文判断" : "自动发现，可抽检";

export default function ReviewWorkbench({ params }: { params: Promise<{ runId: string }> }) {
  const [runId, setRunId] = useState("");
  const [workbench, setWorkbench] = useState<Workbench | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [requestedNodeId, setRequestedNodeId] = useState("");
  const [queryReady, setQueryReady] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    params.then((value) => setRunId(value.runId));
  }, [params]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setRequestedNodeId(new URLSearchParams(window.location.search).get("nodeId") ?? "");
      setQueryReady(true);
    });
  }, []);

  const load = useCallback(
    async (preserveNodeId = "") => {
      if (!runId) return;
      setLoading(true);
      try {
        const query = requestedNodeId ? `?nodeId=${encodeURIComponent(requestedNodeId)}` : "";
        const response = await fetch(`/api/runs/${runId}/review-workbench${query}`);
        const payload = await response.json();
        if (response.status === 401) {
          setNeedsLogin(true);
          setWorkbench(null);
          setError("");
          return;
        }
        if (!response.ok) throw new Error(payload.error?.message ?? "审核工作台读取失败");
        const next = payload as Workbench;
        const selectable = next.manualSelection
          ? [
              next.manualSelection,
              ...next.prioritySamples.filter(
                (sample) => sample.node.resultNodeId !== next.manualSelection?.node.resultNodeId,
              ),
            ]
          : next.prioritySamples;
        const selected =
          selectable.find((sample) => sample.node.resultNodeId === preserveNodeId) ??
          next.manualSelection ??
          selectable.find((sample) => !sample.node.currentReview) ??
          selectable[0];
        setWorkbench(next);
        setNeedsLogin(false);
        setSelectedNodeId(selected?.node.resultNodeId ?? "");
        setNote(selected?.node.currentReview?.note ?? "");
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "审核工作台读取失败");
      } finally {
        setLoading(false);
      }
    },
    [runId, requestedNodeId],
  );

  useEffect(() => {
    if (runId && queryReady)
      void Promise.resolve()
        .then(() => load(""))
        .catch(() => setError("审核工作台读取失败"));
  }, [runId, load, queryReady]);

  const selectableSamples = useMemo(() => {
    if (!workbench) return [];
    if (
      !workbench.manualSelection ||
      workbench.prioritySamples.some(
        (sample) => sample.node.resultNodeId === workbench.manualSelection?.node.resultNodeId,
      )
    )
      return workbench.prioritySamples;
    return [workbench.manualSelection, ...workbench.prioritySamples];
  }, [workbench]);

  const selected = useMemo(
    () => selectableSamples.find((sample) => sample.node.resultNodeId === selectedNodeId),
    [selectableSamples, selectedNodeId],
  );
  const reviewPath = `/scans/${runId}/review${
    requestedNodeId ? `?nodeId=${encodeURIComponent(requestedNodeId)}` : ""
  }`;

  const chooseSample = (sample: Workbench["prioritySamples"][number]) => {
    setSelectedNodeId(sample.node.resultNodeId);
    setNote(sample.node.currentReview?.note ?? "");
    setMessage("");
  };

  async function submit(verdict: Verdict) {
    if (!selected || !workbench?.canReview || submitting) return;
    const trimmedNote = note.trim();
    if (trimmedNote.length < 5) {
      setMessage("请至少写 5 个字，说明你为什么这样判断，便于以后复核。");
      return;
    }
    const csrf = getCookie("accesscheck_reviewer_csrf");
    if (!csrf) {
      setMessage("Reviewer 会话已失效，请重新登录后提交。");
      return;
    }
    const previous = selected.node.currentReview;
    const body: Record<string, unknown> = {
      resultNodeId: selected.node.resultNodeId,
      verdict,
      note: trimmedNote,
    };
    if (previous) {
      body.expectedRevision = previous.revision;
      body.supersedesReviewId = previous.id;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/reviews/ad-hoc", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "保存失败，请刷新后重试。");
        return;
      }
      setMessage(
        "已更新这个代表节点的人工注记。系统会更新覆盖率，但不会把同组其他节点或自动分数一起改写。",
      );
      await load(selected.node.resultNodeId);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !workbench && !needsLogin) return <p role="status">正在整理审核工作台…</p>;
  if (needsLogin)
    return (
      <section className="card" style={{ maxWidth: 760, margin: "32px auto" }}>
        <h1>人工审核工作台</h1>
        <p>
          先用 reviewer 身份登录，才能查看代表样本并保存人工判断。管理员可以查看扫描结果，但不能代替
          reviewer 提交结论。
        </p>
        <p>
          <a href={`/review/login?next=${encodeURIComponent(reviewPath)}`}>
            Reviewer 登录后回到此工作台
          </a>
          {" · "}
          <a href={`/scans/${runId}/issues?resultType=incomplete`}>只浏览全部自动证据</a>
        </p>
      </section>
    );
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!workbench) return null;

  const contextFindings = workbench.findings.filter(
    (finding) => finding.resultType === "incomplete",
  );
  const automaticFindings = workbench.findings.filter(
    (finding) => finding.resultType === "violation",
  );
  const localization = selected ? workbench.localizations[selected.ruleId] : undefined;

  return (
    <section>
      <div className="card review-intro">
        <p className="pill">日常问题组核对 · 探索性</p>
        <h1>人工审核工作台</h1>
        <p>
          这里不是让你逐条点完 {workbench.summary.contextNodeCount} 个节点。系统先把它们归为{" "}
          {workbench.summary.contextFindingCount} 个“页面 × 规则”问题组，再给你少量代表样本。
        </p>
        <ol className="review-steps">
          <li>
            先看下面的 {workbench.summary.prioritySampleCount} 个代表样本，写下你看到的真实判断。
          </li>
          <li>完成一个问题组的首个日常注记后，系统会自动补入下一个还未覆盖的问题组。</li>
          <li>有疑问时，打开对应问题组，查看该组全部原始节点和页面。</li>
          <li>这一步更新的是人工注记和覆盖率，不会篡改原始扫描结果或自动分数。</li>
        </ol>
        {!workbench.canReview ? (
          <p className="notice">
            当前为 {workbench.role} 身份，只能查看进度；请使用独立 reviewer 身份提交人工判断。
          </p>
        ) : null}
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>全部待核对自动证据</h2>
          <div className="score">{workbench.summary.automaticNodeCount}</div>
          <p className="muted">
            所有 violation 和 incomplete 节点都能展开和单独审核，不会因抽样而丢失。
          </p>
        </div>
        <div className="card">
          <h2>需要上下文判断</h2>
          <div className="score">{workbench.summary.contextFindingCount} 组</div>
          <p className="muted">
            {workbench.summary.contextNodeCount}{" "}
            个节点。一个组可含多个类似元素，但人工结论只作用于实际看过的节点。
          </p>
        </div>
        <div className="card">
          <h2>日常首轮覆盖（可选）</h2>
          <div className="score">
            {workbench.summary.dailyReviewedFindingCount}/{workbench.summary.findingCount}
          </div>
          <p className="muted">
            你已查看 {workbench.summary.dailyReviewedNodeCount} 个节点；还有{" "}
            {workbench.summary.dailyRemainingFindingCount}{" "}
            个问题组尚未留下首条日常注记。这里不是硬性待办，处理完当前建议批次即可停止；剩余问题组仍可从下方完整目录进入。
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>这次审核完成后，会更新什么？</h2>
        <p>
          会立刻更新你的“已查看节点数”、确认/不成立/不确定的人工注记和时间。不会自动把同组其他节点标成已审，也不会改变自动分数。
          如果以后进入正式研究，系统会从所有自动问题中固定抽取最多{" "}
          {workbench.summary.formalReview.maxSamplesPerReviewer} 条代表样本，由两位 reviewer
          独立审核；两人合计最多{" "}
          {workbench.summary.formalReview.maxSamplesPerReviewer *
            workbench.summary.formalReview.reviewerCount}{" "}
          次判断，而不是几百次。
        </p>
        <ol className="review-steps">
          <li>日常核对：先完成代表样本；需要时可从完整证据列表打开任意一个节点。</li>
          <li>正式研究：确认正式研究输入后，系统冻结抽样来源并固定抽取不超过 40 个节点。</li>
          <li>双人独立审核：两位 reviewer 分别提交，彼此看不到对方答案。</li>
          <li>有分歧的样本进入裁决；裁决和复核完成后才冻结成研究结论。</li>
        </ol>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>当前建议队列</h2>
        <p className="muted">
          优先涵盖“需要上下文判断”和高影响自动发现。完成一个问题组的首条日常注记后，会自动补入下一组；你也可以先选最熟悉的页面。
        </p>
        {workbench.prioritySamples.length ? (
          <div className="review-sample-list" aria-label="当前建议样本列表">
            {workbench.prioritySamples.map((sample, index) => (
              <button
                type="button"
                className={
                  sample.node.resultNodeId === selectedNodeId ? "review-sample-active" : "secondary"
                }
                key={sample.node.resultNodeId}
                aria-pressed={sample.node.resultNodeId === selectedNodeId}
                onClick={() => chooseSample(sample)}
              >
                {index + 1}. {workbench.localizations[sample.ruleId]?.zhName ?? sample.ruleId} ·
                待查看
              </button>
            ))}
          </div>
        ) : (
          <p className="notice">
            你已对全部问题组留下至少一条日常注记。若要深入核对同组的其他节点，请在下方完整证据目录中选择具体节点。
          </p>
        )}
      </div>

      {selected ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>现在判断：{localization?.zhName ?? selected.ruleId}</h2>
          <p className="review-meta">
            {resultLabel(selected.resultType)} · 自动影响{" "}
            {selected.impact ?? selected.node.effectiveImpact ?? "未确定"} · 此问题组共{" "}
            {selected.nodeCount} 个节点；日常人工注记已覆盖 {selected.reviewedNodeCount}/
            {selected.nodeCount} 个；你已查看 {selected.currentReviewerReviewedNodeCount}/
            {selected.nodeCount} 个。
          </p>
          {workbench.manualSelection &&
          workbench.manualSelection.node.resultNodeId === selected.node.resultNodeId &&
          !workbench.prioritySamples.some(
            (sample) => sample.node.resultNodeId === selected.node.resultNodeId,
          ) ? (
            <p className="notice">
              这是你从“全部自动证据”中主动打开的节点。它可完整审核，但不会被伪装成今天的必做代表样本。
            </p>
          ) : null}
          <p>
            <strong>页面：</strong>{" "}
            <a href={selected.pageUrl} target="_blank" rel="noreferrer">
              {selected.pageTitle || selected.pageUrl}
            </a>
          </p>
          <p>
            <strong>你要看什么：</strong> {localization?.manualCheck ?? selected.description}
          </p>
          <p>
            <strong>建议修复方向：</strong> {localization?.zhFix ?? selected.help}
          </p>
          <details open>
            <summary>查看这个代表节点的证据</summary>
            <p>
              <strong>元素定位：</strong> <code>{JSON.stringify(selected.node.target)}</code>
            </p>
            {selected.node.failureSummary ? (
              <p>
                <strong>工具提示：</strong> {selected.node.failureSummary}
              </p>
            ) : null}
            {selected.node.frameOriginRelation && selected.node.frameOriginRelation !== "top" ? (
              <p className="muted">
                frame：{selected.node.frameOriginRelation} {selected.node.frameUrl ?? ""}
              </p>
            ) : null}
            <pre className="review-evidence">
              {selected.node.html || "（扫描器未保存 HTML 片段）"}
            </pre>
          </details>
          <p>
            <a
              href={`/scans/${runId}/issues?resultType=${selected.resultType}&pageId=${selected.pageId}&ruleId=${encodeURIComponent(selected.ruleId)}`}
            >
              查看这个问题组的全部 {selected.nodeCount} 个原始节点
            </a>
            {" · "}
            <a href={selected.helpUrl} target="_blank" rel="noreferrer">
              查看 axe 规则帮助
            </a>
          </p>
          {selected.node.currentReview ? (
            <p className="notice">
              你之前的判断：{verdictLabel[selected.node.currentReview.verdict]}
              。重新提交会保留修订痕迹，不会静默覆盖。
            </p>
          ) : null}
          {workbench.canReview ? (
            <>
              <details open className="review-checklist">
                <summary>写理由前，按这三点核对</summary>
                <ol className="review-steps">
                  <li>页面现在是否仍与扫描时的证据相符；若已变化，请明确写“页面已变化”。</li>
                  <li>实际完成这条规则所要求的查看或操作，例如键盘操作、文字替代或页面语义。</li>
                  <li>写下观察到的结果；无法确认时，写明缺少的账号、辅助技术或业务语境。</li>
                </ol>
              </details>
              <label htmlFor="exploratory-review-note">为什么这样判断？</label>
              <textarea
                id="exploratory-review-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2000}
                placeholder="例如：页面中该图片只是装饰，附近已有完整文字说明。"
              />
              <div className="review-actions">
                <button type="button" onClick={() => submit("confirmed")} disabled={submitting}>
                  {submitting ? "保存中…" : "确认存在问题"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => submit("not_an_issue")}
                  disabled={submitting}
                >
                  {submitting ? "保存中…" : "当前页面不构成问题"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => submit("uncertain")}
                  disabled={submitting}
                >
                  {submitting ? "保存中…" : "暂不确定，需要进一步确认"}
                </button>
              </div>
            </>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>所有问题组都可核查</h2>
        <p className="muted">
          这里保留全部 {workbench.summary.findingCount}{" "}
          个问题组的入口。它们不是“必须全部手工点完”的待办；这是你需要时可追溯的完整证据目录。
        </p>
        <details open>
          <summary>
            待上下文判断：{contextFindings.length} 个问题组 / {workbench.summary.contextNodeCount}{" "}
            个节点
          </summary>
          <div className="review-group-list">
            {contextFindings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                runId={runId}
                localization={workbench.localizations[finding.ruleId]}
              />
            ))}
          </div>
        </details>
        <details style={{ marginTop: 12 }}>
          <summary>自动发现，可抽检：{automaticFindings.length} 个问题组</summary>
          <div className="review-group-list">
            {automaticFindings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                runId={runId}
                localization={workbench.localizations[finding.ruleId]}
              />
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

function FindingRow({
  finding,
  runId,
  localization,
}: {
  finding: Finding;
  runId: string;
  localization?: { zhName: string; zhFix: string };
}) {
  return (
    <article className="review-group-row">
      <div>
        <strong>{localization?.zhName ?? finding.ruleId}</strong>
        <span className="pill">{resultLabel(finding.resultType)}</span>
        <p className="muted">
          {finding.pageTitle || finding.pageUrl} · {finding.nodeCount} 个节点 · 日常人工注记已覆盖{" "}
          {finding.reviewedNodeCount}/{finding.nodeCount} 个；当前 reviewer 已查看{" "}
          {finding.currentReviewerReviewedNodeCount}/{finding.nodeCount} 个。
        </p>
      </div>
      <a
        href={`/scans/${runId}/issues?resultType=${finding.resultType}&pageId=${finding.pageId}&ruleId=${encodeURIComponent(finding.ruleId)}`}
      >
        查看原始证据
      </a>
    </article>
  );
}
