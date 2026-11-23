import { z } from "zod";
import { detailsSchemas } from "./details.ts";
import { midiNotesFileSchema } from "./files.ts";
import { jobPayloadSchema, workerJobInputSchema, workerResultSchema } from "./worker.ts";

/** Contracts that cross the language boundary into apps/worker. */
const exported = {
  "details.loop": detailsSchemas.loop,
  "details.oneshot": detailsSchemas.oneshot,
  "details.kit": detailsSchemas.kit,
  "details.midi": detailsSchemas.midi,
  "details.preset": detailsSchemas.preset,
  "midi-notes-file": midiNotesFileSchema,
  "job-payload": jobPayloadSchema,
  "worker-job-input": workerJobInputSchema,
  "worker-result": workerResultSchema,
} as const;

export function renderJsonSchemas(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, schema] of Object.entries(exported)) {
    out[name] = JSON.stringify(z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" }), null, 2) + "\n";
  }
  return out;
}
