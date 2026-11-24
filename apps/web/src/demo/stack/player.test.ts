import { describe, expect, it } from "vitest";
import { eventsInRange } from "./player";

const lane = (lengthBeats: number, notes: [number, number, number, number][], transpose = 0, drums = false) => ({ notes, lengthBeats, transpose, drums });

describe("eventsInRange", () => {
  it("repeats a shorter layer inside the loop", () => {
    const short = lane(4, [[0, 1, 60, 100]]);
    const long = lane(16, [[0, 1, 48, 100], [12, 1, 50, 100]]);
    const ev = eventsInRange([short, long], 16, 0, 16);
    expect(ev.filter((e) => e.layer === 0).map((e) => e.beat)).toEqual([0, 4, 8, 12]);
    expect(ev.filter((e) => e.layer === 1).map((e) => e.beat)).toEqual([0, 12]);
  });
  it("wraps at the loop end and counts absolute beats", () => {
    const l = lane(4, [[0, 1, 60, 100], [3.5, 0.5, 62, 100]]);
    expect(eventsInRange([l], 4, 3, 4.5).map((e) => e.beat)).toEqual([3.5, 4]);
  });
  it("never doubles a note across consecutive windows", () => {
    const l = lane(4, [[0, 0.25, 36, 100], [0.25, 0.25, 42, 100], [1, 0.25, 38, 100]]);
    const chunks = [0, 0.1, 0.25, 0.26, 1, 2.3, 4, 4.25, 8].slice(1).flatMap((to, i, arr) => eventsInRange([l], 4, i === 0 ? 0 : arr[i - 1]!, to));
    expect(chunks.map((e) => e.beat)).toEqual([0, 0.25, 1, 4, 4.25, 5]);
  });
  it("transposes melodic lanes and leaves drums alone", () => {
    const ev = eventsInRange([lane(4, [[0, 1, 60, 100]], 3), lane(4, [[0, 1, 36, 100]], 3, true)], 4, 0, 1);
    expect(ev.map((e) => e.pitch)).toEqual([63, 36]);
  });
  it("cuts a layer that does not divide the loop at the loop end", () => {
    const l = lane(12, [[0, 1, 60, 100], [8, 1, 62, 100]]);
    const long = lane(16, []);
    expect(eventsInRange([l, long], 16, 0, 16).map((e) => e.beat)).toEqual([0, 8, 12]);
  });
});
