import { User } from "@stash/ui";
import { Placeholder, placeholderMetadata } from "../../_shell/placeholder";

export const metadata = placeholderMetadata("Profile");

/**
 * Placeholder until the profile screen is built (ticket 333). The item page's uploader card links
 * here; without a page the router would serve a 404 document as a full load and stop the player.
 */
export default function ProfilePage() {
  return (
    <Placeholder title="Profile" icon={User}>
      Everything this producer has shared, with follow and their totals.
    </Placeholder>
  );
}
