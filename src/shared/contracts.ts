import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1).max(256);
const PropertyNameSchema = z.string().trim().min(1).max(128);
const TextSchema = z.string().trim().min(1);
const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const TurnKeySchema = z.object({
  chatId: IdentifierSchema,
  assistantMessageId: IdentifierSchema,
  swipeId: z.union([IdentifierSchema, NonNegativeIntegerSchema]).nullable().default(null),
  sourceFingerprint: z.string().trim().min(8).max(256),
  revision: NonNegativeIntegerSchema
}).strict();
export type TurnKey = z.infer<typeof TurnKeySchema>;

export const ParagraphSchema = z.object({
  index: NonNegativeIntegerSchema,
  sourceIndex: NonNegativeIntegerSchema,
  text: TextSchema
}).strict();
export type Paragraph = z.infer<typeof ParagraphSchema>;

export const ChoiceSourceSchema = z.enum(["authored", "generated"]);
export const ChoiceSchema = z.object({
  id: IdentifierSchema,
  label: TextSchema,
  submission: TextSchema,
  source: ChoiceSourceSchema,
  unlocksAfterParagraph: NonNegativeIntegerSchema
}).strict();
export type Choice = z.infer<typeof ChoiceSchema>;

export const CharacterContinuitySchema = z.object({
  present: z.boolean().default(true),
  appearance: z.record(PropertyNameSchema, z.string()).default({}),
  wardrobe: z.record(PropertyNameSchema, z.string()).default({}),
  pose: z.string().trim().nullable().default(null),
  expression: z.string().trim().nullable().default(null),
  props: z.array(TextSchema).default([])
}).strict();
export type CharacterContinuity = z.infer<typeof CharacterContinuitySchema>;

export const ContinuityStateSchema = z.object({
  revision: NonNegativeIntegerSchema,
  characters: z.record(IdentifierSchema, CharacterContinuitySchema).default({}),
  facts: z.record(PropertyNameSchema, z.string()).default({})
}).strict();
export type ContinuityState = z.infer<typeof ContinuityStateSchema>;

export const CharacterContinuityPatchSchema = z.object({
  present: z.boolean().optional(),
  appearance: z.record(PropertyNameSchema, z.string().nullable()).optional(),
  wardrobe: z.record(PropertyNameSchema, z.string().nullable()).optional(),
  pose: z.string().trim().nullable().optional(),
  expression: z.string().trim().nullable().optional(),
  props: z.array(TextSchema).optional()
}).strict();
export type CharacterContinuityPatch = z.infer<typeof CharacterContinuityPatchSchema>;

export const ContinuityDeltaSchema = z.object({
  characterUpdates: z.record(IdentifierSchema, CharacterContinuityPatchSchema).default({}),
  forgetCharacters: z.array(IdentifierSchema).default([]),
  factUpdates: z.record(PropertyNameSchema, z.string().nullable()).default({})
}).strict().superRefine((delta, context) => {
  const forgotten = new Set(delta.forgetCharacters);
  for (const name of Object.keys(delta.characterUpdates)) {
    if (forgotten.has(name)) {
      context.addIssue({ code: "custom", path: ["characterUpdates", name], message: "A delta cannot forget and update the same character." });
    }
  }
});
export type ContinuityDelta = z.infer<typeof ContinuityDeltaSchema>;

export const IndexedContinuityDeltaSchema = z.object({
  paragraphIndex: NonNegativeIntegerSchema,
  delta: ContinuityDeltaSchema
}).strict();
export type IndexedContinuityDelta = z.infer<typeof IndexedContinuityDeltaSchema>;

export const SceneEnvironmentSchema = z.object({
  location: TextSchema,
  timeOfDay: z.string().trim().nullable().default(null),
  weather: z.string().trim().nullable().default(null),
  lighting: z.string().trim().nullable().default(null),
  description: TextSchema,
  persistentElements: z.array(TextSchema).default([])
}).strict();
export type SceneEnvironment = z.infer<typeof SceneEnvironmentSchema>;

export const CameraLockSchema = z.object({
  framing: TextSchema,
  angle: TextSchema,
  perspective: TextSchema,
  lens: z.string().trim().nullable().default(null),
  subjectAnchor: TextSchema,
  horizon: TextSchema,
  safeDialogueRegion: TextSchema,
  aspectRatio: z.string().regex(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/)
}).strict();
export type CameraLock = z.infer<typeof CameraLockSchema>;

export const SceneStateSchema = z.object({
  sceneId: IdentifierSchema,
  revision: NonNegativeIntegerSchema,
  startParagraph: NonNegativeIntegerSchema,
  environment: SceneEnvironmentSchema,
  cast: z.array(IdentifierSchema).default([]),
  continuity: ContinuityStateSchema,
  basePrompt: TextSchema,
  identityPrompt: TextSchema.nullable().optional(),
  cameraLock: CameraLockSchema,
  compositionLock: TextSchema,
  activeAssetId: IdentifierSchema.nullable().default(null),
  priorSceneId: IdentifierSchema.nullable().default(null),
  character: TextSchema.nullable().optional(),
  attire: TextSchema.nullable().optional()
}).strict();
export type SceneState = z.infer<typeof SceneStateSchema>;

export const SceneBoundaryReasonSchema = z.enum([
  "initial",
  "location_change",
  "major_time_jump",
  "environment_replacement",
  "forced",
  "none"
]);
export const SceneBoundaryProposalSchema = z.object({
  claimedNewScene: z.boolean(),
  reason: SceneBoundaryReasonSchema,
  location: TextSchema,
  timeOfDay: z.string().trim().nullable().default(null),
  majorTimeJump: z.boolean().default(false),
  environmentReplacement: z.boolean().default(false),
  forced: z.boolean().default(false)
}).strict();
export type SceneBoundaryProposal = z.infer<typeof SceneBoundaryProposalSchema>;

export const StageEffectSchema = z.enum([
  "shake",
  "flash_white",
  "flash_red",
  "zoom_in",
  "fade_to_black"
]);
export type StageEffect = z.infer<typeof StageEffectSchema>;

export const VisualCueKindSchema = z.enum(["flattened_scene", "background", "sprite"]);
export const VisualCueSchema = z.object({
  cueId: IdentifierSchema,
  paragraphIndex: NonNegativeIntegerSchema,
  sceneId: IdentifierSchema,
  sceneRevision: NonNegativeIntegerSchema,
  kind: VisualCueKindSchema,
  action: z.string().trim().nullable().default(null),
  expression: z.string().trim().nullable().default(null),
  poseExpressionId: z.string().trim().optional(),
  character: z.string().trim().nullable().optional(),
  attire: z.string().trim().nullable().optional(),
  effect: StageEffectSchema.optional(),
  promptDelta: z.string().trim().default(""),
  assetJobId: IdentifierSchema,
  bgm: z.string().trim().nullable().optional(),
  sfx: z.string().trim().nullable().optional()
}).strict();
export type VisualCue = z.infer<typeof VisualCueSchema>;

export const AssetJobStatusSchema = z.enum([
  "queued",
  "generating",
  "generated",
  "browser_ready",
  "failed",
  "cancelled"
]);
export type AssetJobStatus = z.infer<typeof AssetJobStatusSchema>;

export const AssetJobPrioritySchema = z.enum(["visible", "next", "background"]);
export type AssetJobPriority = z.infer<typeof AssetJobPrioritySchema>;

const TimestampSchema = z.string().datetime({ offset: true });
export const AssetJobSchema = z.object({
  jobId: IdentifierSchema,
  ownerTurnKey: TurnKeySchema,
  sceneId: IdentifierSchema,
  sceneRevision: NonNegativeIntegerSchema,
  paragraphIndex: NonNegativeIntegerSchema,
  promptFingerprint: z.string().trim().min(8).max(256),
  provider: IdentifierSchema,
  priority: AssetJobPrioritySchema.default("background"),
  status: AssetJobStatusSchema,
  imageId: IdentifierSchema.nullable().default(null),
  imageUrl: z.string().trim().min(1).nullable().default(null),
  error: z.string().trim().min(1).nullable().default(null),
  queuedAt: TimestampSchema,
  startedAt: TimestampSchema.nullable().default(null),
  generatedAt: TimestampSchema.nullable().default(null),
  readyAt: TimestampSchema.nullable().default(null),
  finishedAt: TimestampSchema.nullable().default(null)
}).strict().superRefine((job, context) => {
  const needsStart = ["generating", "generated", "browser_ready", "failed"].includes(job.status);
  if (needsStart && !job.startedAt) {
    context.addIssue({ code: "custom", path: ["startedAt"], message: "This job state needs startedAt." });
  }
  if (["generated", "browser_ready"].includes(job.status) && (!job.imageId || !job.generatedAt)) {
    context.addIssue({ code: "custom", path: ["imageId"], message: "A generated job needs imageId and generatedAt." });
  }
  if (job.status === "browser_ready" && (!job.readyAt || !job.finishedAt)) {
    context.addIssue({ code: "custom", path: ["readyAt"], message: "A browser-ready job needs readyAt and finishedAt." });
  }
  if (job.status === "failed" && (!job.error || !job.finishedAt)) {
    context.addIssue({ code: "custom", path: ["error"], message: "A failed job needs error and finishedAt." });
  }
  if (job.status === "cancelled" && !job.finishedAt) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: "A cancelled job needs finishedAt." });
  }
  if (["queued", "generating"].includes(job.status) && (job.imageId || job.imageUrl || job.generatedAt || job.readyAt || job.finishedAt || job.error)) {
    context.addIssue({ code: "custom", path: ["status"], message: "An unfinished job cannot contain completion evidence." });
  }
  if (job.status === "generated" && (job.readyAt || job.finishedAt || job.error)) {
    context.addIssue({ code: "custom", path: ["status"], message: "A generated job has not finished browser loading." });
  }
  if ((job.status === "failed" || job.status === "cancelled") && (job.imageId || job.imageUrl || job.generatedAt || job.readyAt)) {
    context.addIssue({ code: "custom", path: ["status"], message: "A failed or cancelled job cannot contain image completion evidence." });
  }
});
export type AssetJob = z.infer<typeof AssetJobSchema>;

export const PlanningStatusSchema = z.enum(["planned", "partial", "failed"]);

export const TurnPlanSchema = z.object({
  schemaVersion: z.literal(1),
  key: TurnKeySchema,
  paragraphs: z.array(ParagraphSchema).min(1),
  scenes: z.array(SceneStateSchema).min(1),
  visualCues: z.array(VisualCueSchema).default([]),
  choices: z.array(ChoiceSchema).default([]),
  initialContinuity: ContinuityStateSchema,
  continuityDeltas: z.array(IndexedContinuityDeltaSchema).default([]),
  terminalContinuity: ContinuityStateSchema,
  planningStatus: PlanningStatusSchema,
  createdAt: TimestampSchema
}).strict().superRefine((plan, context) => {
  for (const [index, paragraph] of plan.paragraphs.entries()) {
    if (paragraph.index !== index) {
      context.addIssue({ code: "custom", path: ["paragraphs", index, "index"], message: "Paragraph indexes must be contiguous and zero-based." });
    }
    if (index > 0 && paragraph.sourceIndex <= plan.paragraphs[index - 1]!.sourceIndex) {
      context.addIssue({ code: "custom", path: ["paragraphs", index, "sourceIndex"], message: "Source indexes must be strictly increasing." });
    }
  }

  const finalParagraphIndex = plan.paragraphs.length - 1;
  for (const [index, scene] of plan.scenes.entries()) {
    if (scene.startParagraph > finalParagraphIndex) {
      context.addIssue({ code: "custom", path: ["scenes", index, "startParagraph"], message: "Scene starts outside the turn." });
    }
    if (index === 0 && scene.startParagraph !== 0) {
      context.addIssue({ code: "custom", path: ["scenes", index, "startParagraph"], message: "The first scene must start at paragraph zero." });
    }
    if (index > 0 && scene.startParagraph <= plan.scenes[index - 1]!.startParagraph) {
      context.addIssue({ code: "custom", path: ["scenes", index, "startParagraph"], message: "Scene starts must be strictly increasing." });
    }
    if (index > 0 && scene.priorSceneId !== plan.scenes[index - 1]!.sceneId) {
      context.addIssue({ code: "custom", path: ["scenes", index, "priorSceneId"], message: "Each later scene must point to the preceding scene." });
    }
  }
  const sceneIds = new Set(plan.scenes.map(({ sceneId }) => sceneId));
  if (sceneIds.size !== plan.scenes.length) {
    context.addIssue({ code: "custom", path: ["scenes"], message: "Scene IDs must be unique inside a turn." });
  }

  const sceneAt = (paragraphIndex: number): SceneState | undefined => {
    let active: SceneState | undefined;
    for (const scene of plan.scenes) {
      if (scene.startParagraph > paragraphIndex) break;
      active = scene;
    }
    return active;
  };
  const cueIds = new Set<string>();
  const jobIds = new Set<string>();
  for (const [index, cue] of plan.visualCues.entries()) {
    if (cue.paragraphIndex > finalParagraphIndex) {
      context.addIssue({ code: "custom", path: ["visualCues", index, "paragraphIndex"], message: "Visual cue points outside the turn." });
    }
    const scene = sceneAt(cue.paragraphIndex);
    if (scene && (scene.sceneId !== cue.sceneId || scene.revision !== cue.sceneRevision)) {
      context.addIssue({ code: "custom", path: ["visualCues", index, "sceneId"], message: "Visual cue does not belong to the active scene." });
    }
    if (cueIds.has(cue.cueId)) context.addIssue({ code: "custom", path: ["visualCues", index, "cueId"], message: "Cue IDs must be unique." });
    if (jobIds.has(cue.assetJobId)) context.addIssue({ code: "custom", path: ["visualCues", index, "assetJobId"], message: "Asset job IDs must be unique." });
    cueIds.add(cue.cueId);
    jobIds.add(cue.assetJobId);
  }

  const choiceIds = new Set<string>();
  for (const [index, choice] of plan.choices.entries()) {
    if (choice.unlocksAfterParagraph !== finalParagraphIndex) {
      context.addIssue({ code: "custom", path: ["choices", index, "unlocksAfterParagraph"], message: "Choices unlock after the final paragraph." });
    }
    if (choiceIds.has(choice.id)) context.addIssue({ code: "custom", path: ["choices", index, "id"], message: "Choice IDs must be unique." });
    choiceIds.add(choice.id);
  }

  let lastDeltaParagraph = -1;
  for (const [index, item] of plan.continuityDeltas.entries()) {
    if (item.paragraphIndex > finalParagraphIndex) {
      context.addIssue({ code: "custom", path: ["continuityDeltas", index, "paragraphIndex"], message: "Continuity delta points outside the turn." });
    }
    if (item.paragraphIndex < lastDeltaParagraph) {
      context.addIssue({ code: "custom", path: ["continuityDeltas", index, "paragraphIndex"], message: "Continuity deltas must be ordered by paragraph." });
    }
    lastDeltaParagraph = item.paragraphIndex;
  }
  if (plan.terminalContinuity.revision !== plan.initialContinuity.revision + plan.continuityDeltas.length) {
    context.addIssue({
      code: "custom",
      path: ["terminalContinuity", "revision"],
      message: "Terminal continuity revision must advance once per delta."
    });
  }
});
export type TurnPlan = z.infer<typeof TurnPlanSchema>;
