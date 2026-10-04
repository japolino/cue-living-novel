import type { EvalReply } from "../types.js";
import { REPLIES as PART_A } from "./part-a.js";
import { REPLIES as PART_B } from "./part-b.js";
import { REPLIES as PART_C } from "./part-c.js";

export const REPLIES: EvalReply[] = [...PART_A, ...PART_B, ...PART_C];
