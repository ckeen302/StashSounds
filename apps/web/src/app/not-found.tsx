import { ButtonLink, EmptyState, Search } from "@stash/ui";

/** Any path with no page, inside the shell so the player keeps playing. */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-content flex-col px-3 py-12 tablet:px-4 desktop:px-6">
      <EmptyState
        icon={Search}
        title="This page is not here"
        action={
          <ButtonLink href="/" variant="primary">
            Go home
          </ButtonLink>
        }
      >
        The link may be old, or the page has not been built yet.
      </EmptyState>
    </main>
  );
}
