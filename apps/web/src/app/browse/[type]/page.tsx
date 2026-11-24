import { Compass } from "@stash/ui";
import { Placeholder, placeholderMetadata } from "../../_shell/placeholder";

export const metadata = placeholderMetadata("Browse");

/** Placeholder until its screen is built (ticket 231). */
export default function BrowsePage() {
  return (
    <Placeholder title="Browse" icon={Compass}>
      Tabs for the five types, with filters for BPM, key, genre and tags.
    </Placeholder>
  );
}
