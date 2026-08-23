export type FormalReviewPhase =
  | "exploratory_not_enrolled"
  | "waiting_r1"
  | "waiting_source_freeze"
  | "waiting_source_export"
  | "waiting_batch"
  | "review_ready"
  | "my_review_complete"
  | "formal_review_in_progress"
  | "waiting_review_freeze"
  | "frozen";

export type FormalReviewStatusInput = {
  campaignId: string | null;
  campaignStatus: string | null;
  r1ApprovalCount: number;
  freezeStatus: string | null;
  sourceExportStatus: string | null;
  batchId: string | null;
  batchStatus: string | null;
  reviewFreezeStatus: string | null;
  reviewer: "computer_lead" | "math_lead" | null;
  completedByMe: number;
  totalForMe: number;
};

export type FormalReviewStatus = {
  phase: FormalReviewPhase;
  title: string;
  message: string;
  nextStep: string;
  externalInputRequired: boolean;
  reviewAvailable: boolean;
  myProgress: { completed: number; total: number; remaining: number } | null;
  campaign: { status: string; r1ApprovalCount: number } | null;
};

/**
 * Turns the immutable research-chain state into a deliberately small, human
 * explanation. It never derives another reviewer's progress, answer, or a
 * disagreement signal.
 */
export function deriveFormalReviewStatus(input: FormalReviewStatusInput): FormalReviewStatus {
  const campaign = input.campaignId
    ? { status: input.campaignStatus ?? "planned", r1ApprovalCount: input.r1ApprovalCount }
    : null;
  const myProgress = input.reviewer
    ? {
        completed: input.completedByMe,
        total: input.totalForMe,
        remaining: Math.max(0, input.totalForMe - input.completedByMe),
      }
    : null;
  if (!input.campaignId)
    return {
      phase: "exploratory_not_enrolled",
      title: "正式研究审核尚未开始",
      message:
        "当前扫描可以直接进行日常问题组核对；它尚未被纳入正式研究样本框，所以不会生成双人正式审核任务。",
      nextStep: "先确认研究对象、站点名单和协议；随后由两位负责人提交真实 R1 确认。",
      externalInputRequired: true,
      reviewAvailable: false,
      myProgress,
      campaign,
    };
  if (input.campaignStatus !== "r1_approved")
    return {
      phase: "waiting_r1",
      title: "等待 R1 双负责人确认",
      message: `研究活动已准备，但 R1 真实确认尚未齐全（当前 ${input.r1ApprovalCount}/2）。系统不会用假输入创建正式抽样。`,
      nextStep: "两位负责人分别确认研究协议、样本框、网站许可和评分边界；确认后才能开始正式扫描。",
      externalInputRequired: true,
      reviewAvailable: false,
      myProgress,
      campaign,
    };
  if (!input.freezeStatus)
    return {
      phase: "waiting_source_freeze",
      title: "等待正式扫描与来源冻结",
      message: "R1 已通过；还需要完成研究计划中的正式扫描，并冻结可追溯的来源数据。",
      nextStep: "管理员完成该研究活动的正式扫描和 study freeze，再生成只读 source export。",
      externalInputRequired: false,
      reviewAvailable: false,
      myProgress,
      campaign,
    };
  if (input.sourceExportStatus !== "verified")
    return {
      phase: "waiting_source_export",
      title: "等待来源数据验证",
      message: "正式扫描已经冻结，但用于抽样的只读来源数据还没有验证完成。",
      nextStep: "验证 source export 后，系统才能依据冻结数据固定抽取样本。",
      externalInputRequired: false,
      reviewAvailable: false,
      myProgress,
      campaign,
    };
  if (!input.batchId)
    return {
      phase: "waiting_batch",
      title: "等待固定正式样本",
      message: "来源数据已验证，尚未创建正式抽样批次。日常人工注记不会被自动带入正式结论。",
      nextStep: "管理员创建固定样本；每位 reviewer 最多获得 40 条，而不是几百条节点。",
      externalInputRequired: false,
      reviewAvailable: false,
      myProgress,
      campaign,
    };
  if (input.reviewFreezeStatus === "verified")
    return {
      phase: "frozen",
      title: "正式审核已冻结",
      message: "双人审核与必要裁决已经封存；日常注记仍与正式研究结论保持分离。",
      nextStep: "可进入后续 R4/正式研究产出流程；如需变更，必须创建新的可审计修订链。",
      externalInputRequired: false,
      reviewAvailable: false,
      myProgress,
      campaign,
    };
  if (input.batchStatus === "completed" || input.batchStatus === "completed_no_eligible_items")
    return {
      phase: "waiting_review_freeze",
      title: "等待正式审核冻结",
      message: "固定样本已完成收集，正在等待 R3 验证与正式冻结；不会在此处泄露双人答案或分歧。",
      nextStep: "由有权角色完成 R3 和冻结；之后才能进入研究结论链。",
      externalInputRequired: true,
      reviewAvailable: false,
      myProgress,
      campaign,
    };
  if (input.reviewer && input.totalForMe > 0 && input.completedByMe >= input.totalForMe)
    return {
      phase: "my_review_complete",
      title: "你的正式审核已完成",
      message: "你的固定样本已全部提交。系统会在独立审核、必要裁决和冻结完成后继续推进。",
      nextStep: "暂不需要重复提交；不要尝试查看或推断另一位 reviewer 的进度或答案。",
      externalInputRequired: false,
      reviewAvailable: true,
      myProgress,
      campaign,
    };
  if (input.reviewer)
    return {
      phase: "review_ready",
      title: "正式双人审核可以开始",
      message: "系统已固定你的样本。页面只显示你的队列与进度，确保两位 reviewer 独立判断。",
      nextStep: "打开“我的正式审核”，逐条依据页面和扫描证据写下可复核理由。",
      externalInputRequired: false,
      reviewAvailable: true,
      myProgress,
      campaign,
    };
  return {
    phase: "formal_review_in_progress",
    title: "正式双人审核进行中",
    message:
      "固定样本正在由两位 reviewer 独立审核。为保持盲审，这里不显示任何一方进度、答案或分歧。",
    nextStep: "等待 reviewer 完成；有分歧的样本必须在随后走可审计裁决。",
    externalInputRequired: false,
    reviewAvailable: false,
    myProgress,
    campaign,
  };
}
