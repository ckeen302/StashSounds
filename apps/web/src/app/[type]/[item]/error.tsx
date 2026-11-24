"use client";

import { lazy, Suspense } from "react";

// Next loads an error boundary with its page, so the view itself waits until an error happens
// (the loop page's script budget, ticket 135).
const ItemErrorView = lazy(() => import("../../_item/item-error"));

export default function ItemError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <Suspense fallback={null}>
      <ItemErrorView retry={retry} />
    </Suspense>
  );
}
