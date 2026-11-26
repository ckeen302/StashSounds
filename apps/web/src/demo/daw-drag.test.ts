import { describe, expect, it } from "vitest";
import { downloadUrlValue, mimeOf, safeName } from "./daw-drag";

describe("drag into a DAW", () => {
  it("names files so the DownloadURL value and file systems both take them", () => {
    expect(safeName("Trap Bells: 150 / F#m?.wav")).toBe("Trap Bells 150 F#m .wav");
    expect(safeName("   ")).toBe("sound");
  });

  it("types files by extension, which is what DAWs import by", () => {
    expect(mimeOf("Loop 140bpm.wav")).toBe("audio/wav");
    expect(mimeOf("Chords C minor 140bpm.mid")).toBe("audio/midi");
    expect(mimeOf("hit.mp3")).toBe("audio/mpeg");
    expect(mimeOf("thing.bin", "application/x-thing")).toBe("application/x-thing");
  });

  it("builds Chrome's DownloadURL as type:name:url", () => {
    expect(downloadUrlValue({ type: "audio/wav", name: "Loop 140bpm Am.wav", url: "blob:https://x/1" })).toBe("audio/wav:Loop 140bpm Am.wav:blob:https://x/1");
  });
});
