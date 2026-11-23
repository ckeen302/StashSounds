import { Upload } from "@stash/ui";
import { Placeholder, placeholderMetadata } from "../_shell/placeholder";

export const metadata = placeholderMetadata("Upload");

/** Placeholder until its screen is built (ticket 134). */
export default function UploadPage() {
  return (
    <Placeholder title="Upload" icon={Upload}>
      Drop a loop here to share it, with live processing status.
    </Placeholder>
  );
}
