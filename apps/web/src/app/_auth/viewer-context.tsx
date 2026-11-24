"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Viewer } from "./viewer";

const ViewerContext = createContext<Viewer>({ status: "signed_out" });

/** The root layout reads the session once per request and hands the shell this summary. */
export function ViewerProvider({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

export function useViewer(): Viewer {
  return useContext(ViewerContext);
}
