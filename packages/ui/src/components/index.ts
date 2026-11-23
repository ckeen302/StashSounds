/**
 * The component index. Ticket 131 adds the first twenty components of the design spec's thirty;
 * each appears in /dev/gallery in every state before a screen may use it. Screens compose these and
 * never restyle them. The rest (select, slider, stepper, drop zone, piano roll, pads, keyboard,
 * transport, player bar, sheet) arrive with the tickets that need them.
 */
export type { PreviewState } from "./cx.ts";
export * from "./icon.tsx";
export { Kbd } from "./kbd.tsx";
export { Spinner } from "./spinner.tsx";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button.tsx";
export { IconButton, type IconButtonProps, type IconButtonVariant } from "./icon-button.tsx";
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
export { ToastPreview, ToastProvider, ToastSurface, useToast, type ToastOptions, type ToastTone } from "./toast.tsx";
export { SkeletonBlock, SkeletonCard, SkeletonText } from "./skeleton.tsx";
export { EmptyState, ErrorState } from "./states.tsx";
export { ProgressSteps, type StepStatus, type UploadStep } from "./progress-steps.tsx";
export { ResultHeader, ResultList, ResultListSkeleton, ResultRow, ResultRowSkeleton, type ResultRowProps } from "./result-row.tsx";
export { Waveform, type Peaks, type WaveformProps } from "./waveform.tsx";
export { barHeight, barLayout, barValues, formatTime, fractionAt, MIN_BAR_HEIGHT, WAVEFORM_GEOMETRY, type WaveformVariant } from "./waveform-bars.ts";
export { LinkProvider, UiLink, type LinkLike, type LinkLikeProps } from "./link.tsx";
