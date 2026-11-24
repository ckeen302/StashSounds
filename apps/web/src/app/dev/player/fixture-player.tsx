"use client";

import { useState } from "react";
import { getEngine, usePlayerState } from "@stash/audio";
import { Button, ResultList, ResultRow, useToast, type PlayState } from "@stash/ui";
import { useSignedInAction } from "../../_auth/sign-in-dialog";
import { nowPlaying } from "../../_shell/now-playing";
import { rows } from "../gallery/gallery-data";

const list = [rows.dustySoul, rows.midnightKeys, rows.trapBells, rows.drillLead, rows.rnbPad];

/**
 * The fixture loops as rows that play through the real engine and the shell's player bar. Like,
 * follow and download go through the sign-in gate (ticket 133); their real actions come with their
 * own tickets, so here they mark local state and say so in a toast.
 */
export function FixturePlayer() {
  const engine = getEngine();
  const status = usePlayerState((s) => s.status);
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const toast = useToast();
  const stateOf = (id: string): PlayState => (id !== currentId || status === "idle" ? "paused" : status);
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [followed, setFollowed] = useState<Set<string>>(() => new Set());
  const titleOf = (publicId: string) => list.find((r) => r.publicId === publicId)?.title ?? publicId;

  const like = useSignedInAction("like", (publicId) => {
    setLiked((s) => new Set(s).add(publicId));
    toast({ tone: "success", title: `Liked ${titleOf(publicId)}` });
  });
  const download = useSignedInAction("download", (publicId) => {
    toast({ tone: "info", title: `Downloading ${titleOf(publicId)}` });
  });
  const follow = useSignedInAction("follow", (handle) => {
    setFollowed((s) => new Set(s).add(handle));
    toast({ tone: "success", title: `Following @${handle}` });
  });
  const featured = rows.midnightKeys.owner.handle;

  return (
    <div className="flex flex-col gap-6">
      <ResultList label="Fixture loops">
        {list.map((r, i) => (
          <ResultRow
            key={r.id}
            row={{ ...r, viewer: { liked: liked.has(r.publicId) } }}
            playState={stateOf(r.playable.id)}
            onPlay={() => void nowPlaying().playFrom(engine, list, i)}
            onLike={(on) => (on ? like(r.publicId) : setLiked((s) => new Set([...s].filter((id) => id !== r.publicId))))}
            onDownload={() => download(r.publicId)}
          />
        ))}
      </ResultList>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => toast({ tone: "success", title: "Saved to your library", description: "Find it under Likes." })}>
          Show a toast
        </Button>
        <Button variant={followed.has(featured) ? "ghost" : "secondary"} onClick={() => follow(featured)}>
          {followed.has(featured) ? `Following @${featured}` : `Follow @${featured}`}
        </Button>
      </div>
    </div>
  );
}
