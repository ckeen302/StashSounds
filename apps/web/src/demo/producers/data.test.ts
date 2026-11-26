import { describe, expect, it } from "vitest";
import { allProducers, attachLoopStyles, canonicalName, hrefForProducer, namesIn, producerBySlug, producerNamed } from "./data";

describe("producer pages", () => {
  it("gathers Metro Boomin's presets, samples, song chords and the kit in his style", () => {
    const p = producerNamed("Metro Boomin")!;
    expect(p.slug).toBe("metro-boomin");
    expect(p.presets.length).toBeGreaterThan(10);
    expect(p.samples.length).toBeGreaterThan(10);
    expect(p.midiSongs.size).toBeGreaterThan(0);
    expect([...p.kitStyles]).toContain("Metro Boomin");
  });

  it("files every spelling of a name under one page", () => {
    expect(producerNamed("pierre bourne")?.name).toBe("Pi'erre Bourne");
    expect(producerNamed("DJ Mustard")?.name).toBe("Mustard");
    expect(namesIn("Hit-Boy, Rogét Chahayed & Wheezy (co-producers)", "preset")).toEqual(["Hit-Boy", "Rogét Chahayed", "Wheezy"]);
    expect(namesIn("Tyler, the Creator", "preset")).toEqual(["Tyler, the Creator"]);
  });

  it("skips surnames and scraped sentence fragments in sample credits", () => {
    expect(canonicalName("West", "credit")).toBeNull();
    expect(canonicalName("backing vocals", "credit")).toBeNull();
    expect(canonicalName("| length1 = 3:07", "credit")).toBeNull();
    expect(canonicalName("Mix engineer: Manny Marroquin", "credit")).toBeNull();
    expect(canonicalName("Just Blaze", "credit")).toBe("Just Blaze");
  });

  it("gives every page a unique slug that finds it again", () => {
    const all = allProducers();
    expect(new Set(all.map((p) => p.slug)).size).toBe(all.length);
    for (const p of all.slice(0, 200)) expect(producerBySlug(p.slug)).toBe(p);
    expect(hrefForProducer("Metro Boomin")).toBe("/producer/metro-boomin");
  });

  it("ties loops to a producer by their style tag, only for producers with a page", () => {
    attachLoopStyles(["metro boomin", "ax", "someone unknown"]);
    expect(producerNamed("Metro Boomin")!.loopCount).toBe(1);
    expect(producerNamed("AXL Beats")).toBeNull();
  });
});
