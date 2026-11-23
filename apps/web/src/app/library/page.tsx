import { Library } from "@stash/ui";
import { Placeholder, placeholderMetadata } from "../_shell/placeholder";

export const metadata = placeholderMetadata("Library");

/** Placeholder until its screen is built. */
export default function LibraryPage() {
  return (
    <Placeholder title="Library" icon={Library}>
      Your likes, your downloads with their licenses, and your own uploads.
    </Placeholder>
  );
}
