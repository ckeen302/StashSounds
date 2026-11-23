import { Search } from "@stash/ui";
import { Placeholder, placeholderMetadata } from "../_shell/placeholder";

export const metadata = placeholderMetadata("Search");

/** Placeholder until its screen is built. */
export default function SearchPage() {
  return (
    <Placeholder title="Search" icon={Search}>
      Search every loop, one-shot, kit, MIDI file and preset.
    </Placeholder>
  );
}
