/**
 * The component index. Ticket 131 adds the first twenty components of the design spec's thirty;
 * each appears in /dev/gallery in every state before a screen may use it. Screens compose these and
 * never restyle them. Ticket 132 adds the slider (volume), the player bar and its phone sheet.
 * The rest (select, stepper, drop zone, piano roll, pads, keyboard, transport, a general sheet)
 * arrive with the tickets that need them.
 */
export type { PreviewState } from "./cx.ts";
export * from "./icon.tsx";
export { Kbd } from "./kbd.tsx";
export { Spinner } from "./spinner.tsx";
export { Button, ButtonLink, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button.tsx";
export { IconButton, IconLink, type IconButtonProps, type IconButtonVariant } from "./icon-button.tsx";
export { PlayButton, type PlayButtonProps, type PlayState } from "./play-button.tsx";
export { SearchInput, TextInput, type TextInputProps } from "./input.tsx";
export { FilterChip, TagChip, TypeChip, TYPE_LABEL } from "./chip.tsx";
export { LicenseBadge } from "./license-badge.tsx";
export { Avatar, initials, type AvatarSize } from "./avatar.tsx";
export { UploaderCard, type UploaderCardProps } from "./uploader-card.tsx";
export { Stat, formatCount } from "./stat.tsx";
export { Tab, TabList, TabPanel, Tabs } from "./tabs.tsx";
export { Dialog, DialogPreview, DialogSurface, type DialogProps, type DialogVariant } from "./dialog.tsx";
export { ContextMenu, Menu, MenuPreview, type MenuEntry } from "./menu.tsx";
export { Tooltip, TooltipProvider, TooltipSurface } from "./tooltip.tsx";
export { ToastPreview, ToastProvider, ToastSurface, ToastViewport, useToast, type ToastOptions, type ToastTone } from "./toast.tsx";
export { Slider, volumeText, type SliderProps } from "./slider.tsx";
export { describePlayer, PlayerBar, PlayerSheet, playerFraction, type PlayerBarProps, type PlayerSheetProps, type PlayerStatus } from "./player-bar.tsx";
export { useFrameLoop } from "./frame.ts";
export { SkeletonBlock, SkeletonCard, SkeletonText } from "./skeleton.tsx";
export { EmptyState, ErrorState } from "./states.tsx";
export { ProgressSteps, uploadStepFor, type StepStatus, type UploadStep } from "./progress-steps.tsx";
export { describeRow, lengthText, ResultHeader, ResultList, ResultListSkeleton, ResultRow, ResultRowSkeleton, type ResultRowProps } from "./result-row.tsx";
export { Waveform, type Peaks, type WaveformProps } from "./waveform.tsx";
export {
  barHeight,
  barLayout,
  barValues,
  clamp01,
  formatTime,
  fractionAt,
  loudness,
  MIN_BAR_HEIGHT,
  SEEK_STEP,
  SEEK_STEP_LARGE,
  seekFromKey,
  WAVEFORM_GEOMETRY,
  type WaveformVariant,
} from "./waveform-bars.ts";
export { LinkProvider, UiLink, type LinkLike, type LinkLikeProps } from "./link.tsx";
