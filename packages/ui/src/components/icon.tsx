import type { LucideIcon } from "lucide-react";
import { cx } from "./cx.ts";

export type { LucideIcon as IconComponent } from "lucide-react";

/**
 * One outline set (Lucide) at 16 or 20 px with a 1.5 px stroke. Design spec: Rules for building them.
 * Icons are decorative by default; the control that holds one carries the label.
 */
export function Icon({
  icon: Glyph,
  size = 16,
  className,
  label,
}: {
  icon: LucideIcon;
  size?: 16 | 20;
  className?: string;
  /** Set only when the icon alone carries meaning (it then gets role="img"). */
  label?: string;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.5}
      absoluteStrokeWidth
      className={cx("shrink-0", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
    />
  );
}

/** The icons the interface uses, re-exported so every screen draws from the same set. */
export {
  AudioWaveform,
  Bell,
  Check,
  CircleCheck,
  CircleExclamationPoint,
  Copy,
  Download,
  Ellipsis,
  Flag,
  Heart,
  Inbox,
  Info,
  Link,
  Pause,
  Play,
  Plus,
  RotateCw,
  Search,
  Share2,
  SlidersHorizontal,
  Trash,
  TriangleExclamationPoint,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
