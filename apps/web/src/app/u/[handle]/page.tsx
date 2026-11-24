import { User } from "@stash/ui";
import { Placeholder, placeholderMetadata } from "../../_shell/placeholder";

export const metadata = placeholderMetadata("Profile");

/** Placeholder until the profile screen is built. The Profile tab points here for a member (133). */
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return (
    <Placeholder title={`@${handle}`} icon={User}>
      Uploads, likes and followers will show here.
    </Placeholder>
  );
}
