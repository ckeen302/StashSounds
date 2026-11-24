import { Bell } from "@stash/ui";
import { Placeholder, placeholderMetadata } from "../_shell/placeholder";

export const metadata = placeholderMetadata("Notifications");

/** Placeholder until its screen is built. */
export default function NotificationsPage() {
  return (
    <Placeholder title="Notifications" icon={Bell}>
      New followers, likes and downloads, batched and unread first.
    </Placeholder>
  );
}
