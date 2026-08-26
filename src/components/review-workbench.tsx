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
  resultType: "incomplete";
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

const resultLabel = (_type: Finding["resultType"]) => "待上下文判断";

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
          <h2>待判断 incomplete</h2>
          <div className="score">{workbench.summary.contextNodeCount}</div>
          <p className="muted">
            这里才是人工或 AI 需要处理的节点。violation 已由 axe 自动判定，不进入这个队列。
          </p>
        </div>
        <div className="card">
          <h2>内部归类</h2>
          <div className="score">{workbench.summary.contextFindingCount} 组</div>
          <p className="muted">
            按“页面 × 规则”整理 {workbench.summary.contextNodeCount} 个节点；分组只用于导航和统计。
          </p>
        </div>
        <div className="card">
          <h2>建议样本</h2>
          <div className="score">{workbench.summary.prioritySampleCount}</div>
          <p className="muted">
            每个优先组先给一个代表节点；提交后可以继续下一个。已记录{" "}
            {workbench.summary.dailyReviewedNodeCount} 条判断。
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>审核规则</h2>
        <p>
          这里只处理
          incomplete。你提交的结论只作用于当前节点，不会把同组其他节点一起改掉，也不会修改原始 axe
          结果或自动分数。
        </p>
        <p className="muted">
          正式研究仍会从冻结后的研究样本中独立抽取最多{" "}
          {workbench.summary.formalReview.maxSamplesPerReviewer} 条，由两位 reviewer
          分别判断；这与当前日常审核分开。
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>建议样本队列</h2>
        <p className="muted">
          系统从 incomplete
          组中按固定顺序挑选代表节点。完成一个组的首条注记后，会自动补入下一个未覆盖的组。
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
            当前没有未处理的建议样本。需要深入核对时，可从问题明细页打开具体 incomplete 节点。
          </p>
        )}
      </div>

      {selected ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>现在判断：{localization?.zhName ?? selected.ruleId}</h2>
          <p className="review-meta">
            {resultLabel(selected.resultType)} · 自动影响{" "}
            {selected.impact ?? selected.node.effectiveImpact ?? "未确定"} · 同组共{" "}
            {selected.nodeCount} 个节点；你已查看 {selected.currentReviewerReviewedNodeCount}/
            {selected.nodeCount} 个。
          </p>
          {workbench.manualSelection &&
          workbench.manualSelection.node.resultNodeId === selected.node.resultNodeId &&
          !workbench.prioritySamples.some(
            (sample) => sample.node.resultNodeId === selected.node.resultNodeId,
          ) ? (
            <p className="notice">这是你从问题明细页直接打开的节点，不计入建议样本顺序。</p>
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
              查看同组其他 {selected.nodeCount} 个原始节点
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
        <h2>incomplete 分组目录</h2>
        <p className="muted">
          这里按“页面 × 规则”保留全部 {contextFindings.length} 个 incomplete
          组的入口；分组只用于查找，真正的判断仍逐节点保存。violation 不在此处。
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
