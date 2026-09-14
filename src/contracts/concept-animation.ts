import { z } from "zod";

/**
 * 成象（概念动画）共享契约：把一个概念或一句话，变成一份可离线打开的单文件讲解动画。
 * HTTP DTO、应用命令与验证脚本都以本文件为准，类型从 schema 推导，
 * 不在路由或前端复制第二份。
 *
 * 动效本身由模型产出的单文件 HTML 承载（自包含、不引用外部资源），
 * 产品侧只负责约束输入、注入资料、校验产物并做安全加固，不解析动画内部结构。
 */

export const CONCEPT_ANIMATION_STATUS = ["completed", "failed"] as const;
export type ConceptAnimationStatus = (typeof CONCEPT_ANIMATION_STATUS)[number];

export const CONCEPT_ANIMATION_ERROR = [
  "INVALID_INPUT",
  "MODEL_OUTPUT_INVALID",
  "UPSTREAM_ERROR",
  "RATE_LIMITED",
  "TIMEOUT",
  "INTERNAL_ERROR",
] as const;
export type ConceptAnimationErrorCode = (typeof CONCEPT_ANIMATION_ERROR)[number];

/**
 * 参考资料的状态：
 * - used：取到并注入了知乎检索摘要；
 * - skipped：请求方主动关闭取料；
 * - unavailable：取料失败（限流/额度耗尽/未配凭证），已降级为凭模型知识生成。
 */
export const CONCEPT_ANIMATION_MATERIAL_STATUS = ["used", "skipped", "unavailable"] as const;
export type ConceptAnimationMaterialStatus = (typeof CONCEPT_ANIMATION_MATERIAL_STATUS)[number];

/** 生成请求：topic 是要讲解的概念或一句话；instruction 为可选补充要求。输入先去首尾空白。 */
export const ConceptAnimationRequest = z
  .object({
    topic: z.string().trim().min(1).max(200),
    instruction: z.string().trim().max(2000).optional(),
    /** 是否在生成前取一批知乎检索摘要作为参考资料；默认开启。 */
    useMaterial: z.boolean().default(true),
  })
  .strict();
export type ConceptAnimationRequest = z.infer<typeof ConceptAnimationRequest>;

/**
 * 展示给用户的参考资料条目：标题、原文链接、作者与摘要片段。
 * excerpt 是知乎检索摘要的片段，**不是原文全文**，界面必须如实标注。
 */
export const ConceptAnimationReference = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    url: z.string().min(1),
    authorName: z.string().min(1).nullable(),
    excerpt: z.string(),
  })
  .strict();
export type ConceptAnimationReference = z.infer<typeof ConceptAnimationReference>;

/** 产出所用的模型信息，可直接展示给用户；不含密钥。 */
export const ConceptAnimationModelInfo = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
  })
  .strict();
export type ConceptAnimationModelInfo = z.infer<typeof ConceptAnimationModelInfo>;

/**
 * 产物校验结果：结构是否成文档、是否含实际动画、是否仍然自包含。
 * issues 为人类可读的未通过原因，也用于驱动一次修正重生成。
 */
export const ConceptAnimationValidation = z
  .object({
    passed: z.boolean(),
    issues: z.array(z.string()),
  })
  .strict();
export type ConceptAnimationValidation = z.infer<typeof ConceptAnimationValidation>;

export const ConceptAnimationResult = z
  .object({
    status: z.enum(CONCEPT_ANIMATION_STATUS),
    /** 自包含单文件 HTML；失败时为空字符串。 */
    html: z.string(),
    title: z.string(),
    model: ConceptAnimationModelInfo.nullable(),
    validation: ConceptAnimationValidation,
    /** 首轮未过校验、模型按修正要求重生成的次数（本版本最多一次）。 */
    repairs: z.number().int().min(0),
    /** 安全加固时被移除的外部引用数量，便于观测模型是否守约。 */
    strippedReferences: z.number().int().min(0),
    /** 本次注入的参考资料；取料关闭或失败时为空数组。 */
    references: z.array(ConceptAnimationReference),
    materialStatus: z.enum(CONCEPT_ANIMATION_MATERIAL_STATUS),
    /** 失败时的错误码与可读原因；成功为 null。 */
    error: z
      .object({ code: z.enum(CONCEPT_ANIMATION_ERROR), message: z.string() })
      .strict()
      .nullable(),
  })
  .strict();
export type ConceptAnimationResult = z.infer<typeof ConceptAnimationResult>;

/** 保存下来的成象记录：生成结果加上身份与时间，供历史列表与详情读取。 */
export const AnimationRecord = z
  .object({
    id: z.string().min(1),
    topic: z.string().min(1),
    title: z.string(),
    instruction: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    html: z.string(),
    model: ConceptAnimationModelInfo.nullable(),
    references: z.array(ConceptAnimationReference),
    materialStatus: z.enum(CONCEPT_ANIMATION_MATERIAL_STATUS),
  })
  .strict();
export type AnimationRecord = z.infer<typeof AnimationRecord>;

/** 列表项：不含 html，避免一次拉回全部动画正文。 */
export const AnimationSummary = AnimationRecord.omit({ html: true });
export type AnimationSummary = z.infer<typeof AnimationSummary>;

export const AnimationSummaryList = z
  .object({
    items: z.array(AnimationSummary),
    total: z.number().int().min(0),
  })
  .strict();
export type AnimationSummaryList = z.infer<typeof AnimationSummaryList>;
