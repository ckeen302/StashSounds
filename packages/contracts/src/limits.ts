import { z } from "zod";
import raw from "../limits.json" with { type: "json" };

const formats = z.array(z.string().min(1)).min(1);
const positiveInt = z.int().positive();

export const limitsSchema = z.object({
  version: positiveInt,
  loop: z.object({ formats, maxBytes: positiveInt, maxDurationMs: positiveInt }),
  oneshot: z.object({ formats, maxBytes: positiveInt, maxDurationMs: positiveInt }),
  kit: z.object({
    formats,
    maxBytes: positiveInt,
    maxUnpackedBytes: positiveInt,
    maxFiles: positiveInt,
    maxFolderDepth: positiveInt,
    maxCompressionRatio: positiveInt,
    allowNestedArchives: z.boolean(),
    flagShareMatched: z.number().gt(0).lte(1),
  }),
  midi: z.object({ formats, maxBytes: positiveInt, maxNotes: positiveInt, maxDurationMs: positiveInt }),
  preset: z.object({
    formats,
    maxBytes: positiveInt,
    demo: z.object({ formats, minDurationMs: positiveInt, maxDurationMs: positiveInt, maxBytes: positiveInt }),
  }),
  text: z.object({
    titleMax: positiveInt,
    descriptionMax: positiveInt,
    bioMax: positiveInt,
    displayNameMax: positiveInt,
    handlePattern: z.string(),
    handleMin: positiveInt,
    handleMax: positiveInt,
  }),
  tags: z.object({ perItem: positiveInt, minLength: positiveInt, maxLength: positiveInt }),
  quota: z.object({ storageBytes: positiveInt, storageBytesTrusted: positiveInt, uploadsPerDay: positiveInt }),
  preview: z.object({
    loopBitrateKbpsShort: positiveInt,
    loopShortMaxMs: positiveInt,
    loopBitrateKbpsLong: positiveInt,
    oneshotBitrateKbps: positiveInt,
  }),
  loudness: z.object({ targetLufs: z.number(), truePeakDb: z.number(), oneshotPeakDb: z.number() }),
  waveform: z.object({ peakPoints: positiveInt }),
  urls: z.object({ uploadTtlSeconds: positiveInt, downloadTtlSeconds: positiveInt }),
  multipart: z.object({ thresholdBytes: positiveInt, partBytes: positiveInt }),
  rateLimits: z.object({
    likesPerHour: positiveInt,
    followsPerHour: positiveInt,
    reportsPerDay: positiveInt,
    downloadsPerDay: positiveInt,
    searchPerMinutePerAddress: positiveInt,
  }),
  worker: z.object({
    timeoutsSeconds: z.object({ audio: positiveInt, kit: positiveInt, midi: positiveInt, presetRender: positiveInt }),
    maxAttempts: positiveInt,
    backoffSeconds: z.array(positiveInt).min(1),
    fingerprintThreshold: z.number().gt(0).lte(1),
  }),
  lists: z.object({ pageSize: positiveInt, trendingWindowDays: positiveInt }),
  moderation: z.object({ upheldTakedownsBeforeSuspension: positiveInt, openReportsToQueue: positiveInt }),
  performance: z.object({
    firstSoundMsFast: positiveInt,
    firstSoundMsThrottled: positiveInt,
    itemPageLcpMs: positiveInt,
    itemPageCls: z.number().nonnegative(),
    scriptBeforeAudioBytes: positiveInt,
  }),
  bpm: z.object({ min: positiveInt, max: positiveInt, fileNameMin: positiveInt, fileNameMax: positiveInt }),
  licenses: z.object({
    royalty_free: z.object({ version: z.string() }),
    credit_required: z.object({ version: z.string() }),
    split_on_placement: z.object({ version: z.string(), minPercent: positiveInt, maxPercent: positiveInt }),
  }),
});

export type Limits = z.infer<typeof limitsSchema>;

/** Parsed once at import; a malformed limits.json fails loudly at startup, not at first use. */
export const limits: Limits = limitsSchema.parse(raw);
