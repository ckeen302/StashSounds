import { z } from "zod";

/** Mirrors the Postgres enums and check constraints in supabase/migrations. Change both together. */

export const itemTypeSchema = z.enum(["loop", "oneshot", "kit", "midi", "preset"]);
export type ItemType = z.infer<typeof itemTypeSchema>;
export const ITEM_TYPES = itemTypeSchema.options;

export const itemStatusSchema = z.enum(["draft", "processing", "ready", "published", "flagged", "removed"]);
export type ItemStatus = z.infer<typeof itemStatusSchema>;

export const licenseKindSchema = z.enum(["royalty_free", "credit_required", "split_on_placement"]);
export type LicenseKind = z.infer<typeof licenseKindSchema>;

export const keyModeSchema = z.enum(["major", "minor"]);
export type KeyMode = z.infer<typeof keyModeSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "done", "failed"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** One job kind per content type, plus the isolated Vital renderer. */
export const jobKindSchema = z.enum([
  "process_loop",
  "process_oneshot",
  "process_kit",
  "process_midi",
  "process_preset",
  "render_vital",
]);
export type JobKind = z.infer<typeof jobKindSchema>;

export const fileRoleSchema = z.enum(["original", "preview", "peaks", "notes", "demo", "sampled_note", "cover"]);
export type FileRole = z.infer<typeof fileRoleSchema>;

export const bucketSchema = z.enum(["originals", "previews"]);
export type Bucket = z.infer<typeof bucketSchema>;

export const tagKindSchema = z.enum(["tag", "instrument", "mood", "reference"]);
export type TagKind = z.infer<typeof tagKindSchema>;

export const accountRoleSchema = z.enum(["user", "trusted", "admin"]);
export type AccountRole = z.infer<typeof accountRoleSchema>;

export const kitCategorySchema = z.enum([
  "kick",
  "snare",
  "clap",
  "hat",
  "open_hat",
  "808",
  "perc",
  "tom",
  "cymbal",
  "fx",
  "vocal",
  "other",
]);
export type KitCategory = z.infer<typeof kitCategorySchema>;
/** Pad order for the first sixteen samples of a kit. Build spec: Drum kit, Order. */
export const KIT_PAD_ORDER: readonly KitCategory[] = [
  "kick",
  "snare",
  "clap",
  "hat",
  "open_hat",
  "808",
  "perc",
  "tom",
  "cymbal",
  "fx",
  "vocal",
  "other",
];

export const oneshotCategorySchema = z.enum(["808", "kick", "snare", "clap", "hat", "perc", "fx", "texture", "vocal", "bass", "other"]);
export type OneshotCategory = z.infer<typeof oneshotCategorySchema>;

export const midiKindSchema = z.enum(["chords", "melody", "drums", "bass"]);
export type MidiKind = z.infer<typeof midiKindSchema>;

export const presetSynthSchema = z.enum(["vital", "serum", "other"]);
export type PresetSynth = z.infer<typeof presetSynthSchema>;

export const presetCategorySchema = z.enum(["bass", "lead", "pad", "pluck", "keys", "fx", "other"]);
export type PresetCategory = z.infer<typeof presetCategorySchema>;

export const notificationKindSchema = z.enum(["follow", "like", "upload", "flag", "takedown"]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const reportReasonSchema = z.enum(["stolen", "copyright", "spam", "abuse", "other"]);
export type ReportReason = z.infer<typeof reportReasonSchema>;

export const reportStatusSchema = z.enum(["open", "upheld", "dismissed"]);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const dmcaStatusSchema = z.enum(["received", "removed", "countered", "restored", "rejected"]);
export type DmcaStatus = z.infer<typeof dmcaStatusSchema>;

/** The sounds in the custom MIDI SoundFont. Build spec: Audio engine interface. */
export const soundIdSchema = z.enum(["keys", "pluck", "pad", "bass", "808", "bell", "strings", "drums"]);
export type SoundId = z.infer<typeof soundIdSchema>;

export const sortSchema = z.enum(["new", "trending"]);
export type Sort = z.infer<typeof sortSchema>;

export const profileLinkKindSchema = z.enum(["instagram", "youtube", "beatstars", "soundcloud", "tiktok", "x", "website"]);
export type ProfileLinkKind = z.infer<typeof profileLinkKindSchema>;
