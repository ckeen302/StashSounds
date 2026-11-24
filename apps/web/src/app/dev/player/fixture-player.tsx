"use client";

import { getEngine, usePlayerState } from "@stash/audio";
import { Button, ResultList, ResultRow, useToast, type PlayState } from "@stash/ui";
import { nowPlaying } from "../../_shell/now-playing";
import { rows } from "../gallery/gallery-data";

const list = [rows.dustySoul, rows.midnightKeys, rows.trapBells, rows.drillLead, rows.rnbPad];

/** The fixture loops as rows that play through the real engine and the shell's player bar. */
export function FixturePlayer() {
  const engine = getEngine();
  const status = usePlayerState((s) => s.status);
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const toast = useToast();
  const stateOf = (id: string): PlayState => (id !== currentId || status === "idle" ? "paused" : status);

  return (
    <div className="flex flex-col gap-6">
      <ResultList label="Fixture loops">
        {list.map((r, i) => (
          <ResultRow key={r.id} row={r} playState={stateOf(r.playable.id)} onPlay={() => void nowPlaying().playFrom(engine, list, i)} />
        ))}
      </ResultList>
      <div>
        <Button variant="secondary" onClick={() => toast({ tone: "success", title: "Saved to your library", description: "Find it under Likes." })}>
          Show a toast
        </Button>
      </div>
    </div>
  );
}
