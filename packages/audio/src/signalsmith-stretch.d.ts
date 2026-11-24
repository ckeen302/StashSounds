// signalsmith-stretch 1.3.2 ships no types. This declares what the installed SignalsmithStretch.mjs
// exports and attaches to its node (read from that file and its README).
declare module "signalsmith-stretch" {
  interface SignalsmithStretchNode extends AudioWorkletNode {
    inputTime: number;
    addBuffers(channels: Float32Array[], transfer?: Transferable[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
    schedule(
      change: {
        output?: number;
        active?: boolean;
        input?: number;
        rate?: number;
        semitones?: number;
        tonalityHz?: number;
        formantSemitones?: number;
        formantCompensation?: boolean;
        formantBaseHz?: number;
        loopStart?: number;
        loopEnd?: number;
      },
      adjustPrevious?: boolean,
    ): Promise<unknown>;
    start(when?: number, offset?: number, duration?: number, rate?: number, semitones?: number): Promise<unknown>;
    stop(when?: number): Promise<unknown>;
    latency(): Promise<number>;
    configure(config: { blockMs?: number; intervalMs?: number; splitComputation?: boolean; preset?: "default" | "cheaper" }): Promise<unknown>;
    setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<unknown>;
  }
  interface SignalsmithStretchFactory {
    (context: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<SignalsmithStretchNode>;
    /** Read before the library falls back to stringifying its own functions into a Blob URL for addModule. */
    moduleUrl?: string;
  }
  const SignalsmithStretch: SignalsmithStretchFactory;
  export default SignalsmithStretch;
}
