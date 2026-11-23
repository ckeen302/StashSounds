import { User } from "@stash/ui";
import { Placeholder, placeholderMetadata } from "../_shell/placeholder";

export const metadata = placeholderMetadata("Sign in");

/** Placeholder until its screen is built (ticket 133). */
export default function SignInPage() {
  return (
    <Placeholder title="Sign in" icon={User}>
      Sign in with an email link, Google or Discord.
    </Placeholder>
  );
}
