import found from "./found.json" with { type: "json" };

/**
 * The presets tab: which synth (and, where anyone has said, which preset) is on a song. Researched
 * on 24 November 2026 from producer interviews, engineer interviews, press and community threads.
 * Exact presets are rarely published, so every row says how sure it is and links where it came
 * from. Nothing here is audio from the songs: "Hear a sketch" plays one of the demo's own patches.
 */

export type Confidence = "producer" | "engineer" | "press" | "community";

export const CONFIDENCE: Record<Confidence, { label: string; blurb: string }> = {
  producer: { label: "Legendary · producer said it", blurb: "The producer named the sound in their own words, in an interview." },
  engineer: { label: "Epic · engineer said it", blurb: "The song's mix engineer named it in an interview about the session." },
  press: { label: "Rare · press reported", blurb: "A music-tech outlet or reference page reported it. It may be by ear." },
  community: { label: "Common · community found", blurb: "Producers in a forum thread matched it by ear. Unverified: check before you rely on it." },
};

export type Source = { label: string; url: string };

export type PresetEntry = {
  song: string;
  artist: string;
  producer: string;
  /** The plugin, library or instrument. */
  plugin: string;
  /** The preset or patch name, when anyone has said one. */
  preset: string | null;
  /** Where the preset sits in the browser, when given. */
  path?: string;
  role: string;
  confidence: Confidence;
  /** Short and verbatim, from the source. */
  quote?: string;
  quoteBy?: string;
  source: Source;
  /** The demo patch that gets closest (older rows; the page no longer plays sketches). */
  sketch?: string;
};

const NI_ROGET: Source = { label: "Native Instruments blog, interview with Rogét Chahayed", url: "https://blog.native-instruments.com/roget-chahayed-interview/" };
const SOS_ROGET: Source = { label: "Sound On Sound, Inside Track: Rogét Chahayed", url: "https://www.soundonsound.com/techniques/inside-track-roget-chahayed" };
const SOS_HARLOW: Source = { label: "Sound On Sound, Inside Track: Jack Harlow 'Lovin On Me'", url: "https://www.soundonsound.com/techniques/inside-track-jack-harlow-lovin-me" };
const SOS_TECCA: Source = { label: "Sound On Sound, Inside Track: Lil Tecca 'Ransom'", url: "https://www.soundonsound.com/techniques/inside-track-lil-tecca-ransom" };
const SOS_SKI: Source = { label: "Sound On Sound, Inside Track: Young Thug & Gunna 'Ski'", url: "https://www.soundonsound.com/techniques/inside-track-young-thug-gunna-ski" };
const MR_KENDRICK: Source = { label: "MusicRadar, the Omnisphere preset in Kendrick Lamar's Super Bowl show", url: "https://www.musicradar.com/news/omnisphere-kendrick-lamar-super-bowl" };
const WIKI_XO: Source = { label: "Wikipedia, XO Tour Llif3 (citing Rap-Up)", url: "https://en.wikipedia.org/wiki/XO_Tour_Llif3" };
const YT_XO: Source = { label: "YouTube, \"The Real Original XO Tour Llif3 beat | TM88\" (upload description)", url: "https://www.youtube.com/watch?v=SdMVe3G5ivo" };
const KTT2: Source = { label: "KTT2 forum, \"Presets used in popular songs\" thread", url: "https://www.ktt2.com/presets-used-in-popular-songs-74935" };

const HAND: PresetEntry[] = [
  // ---- Producer's own words
  {
    song: "SICKO MODE", artist: "Travis Scott feat. Drake", producer: "Rogét Chahayed, Hit-Boy", plugin: "Native Instruments Kontakt (Factory Library)",
    preset: "Rapman Waw", path: "Factory Library › Vintage › Vintage Toys", role: "Intro organ", confidence: "producer",
    quote: "inspired by the almighty Rapman Waw patch", quoteBy: "Rogét Chahayed", source: NI_ROGET, sketch: "Toy organ",
  },
  {
    song: "Guard Your Heart", artist: "Big Sean", producer: "Hit-Boy, Rogét Chahayed", plugin: "Native Instruments Kontakt (Factory Library)",
    preset: "Classic Bass", role: "Bass", confidence: "producer",
    quote: "The bass was also from the Factory Library, the Classic Bass sound", quoteBy: "Rogét Chahayed", source: NI_ROGET, sketch: "Reese bass",
  },
  {
    song: "Lovin On Me", artist: "Jack Harlow", producer: "Sean Momberger and others", plugin: "Spectrasonics Trillian",
    preset: null, role: "Bass line, an ARP Odyssey sound", confidence: "producer",
    quote: "I pulled up an ARP Odyssey sound in Spectrasonics’ Trillian plug‑in", quoteBy: "Sean Momberger", source: SOS_HARLOW, sketch: "Reese bass",
  },
  {
    song: "First Class", artist: "Jack Harlow", producer: "Rogét Chahayed and others", plugin: "Nord Stage 3; Logic Pro electric piano",
    preset: null, role: "Strings from the Nord; the Rhodes at the end", confidence: "producer",
    quote: "the Rhodes at the end comes from Logic’s standard electric piano", quoteBy: "Rogét Chahayed", source: SOS_ROGET, sketch: "Dark keys",
  },
  {
    song: "Vertigo", artist: "Khalid", producer: "John Hill, Rogét Chahayed", plugin: "Native Instruments Kontakt",
    preset: "Jazz Guitar (factory library)", role: "Guitar", confidence: "producer",
    quote: "one of my favorite Kontakt instruments, which is the Jazz Guitar factory sample library", quoteBy: "Rogét Chahayed", source: NI_ROGET, sketch: "Pluck house",
  },
  {
    song: "Blue Benz", artist: "Nas", producer: "Hit-Boy, Rogét Chahayed", plugin: "Native Instruments Kontakt",
    preset: null, role: "Everything on his part of the beat", confidence: "producer",
    quote: "I exclusively used all Kontakt plugins and Native Instruments stuff", quoteBy: "Rogét Chahayed", source: NI_ROGET, sketch: "Dark keys",
  },

  // ---- Engineer's account
  {
    song: "Ransom", artist: "Lil Tecca", producer: "Nick Mira, Taz Taylor", plugin: "Roland Juno-106 and Spectrasonics Omnisphere",
    preset: null, role: "The two chord and melody layers", confidence: "engineer",
    quote: "One is from a [Roland] Juno 106 and the other from [Spectrasonics] Omnisphere", quoteBy: "Joseph Colmenero, mix engineer", source: SOS_TECCA, sketch: "Plugg bell",
  },
  {
    song: "Ski", artist: "Young Thug & Gunna", producer: "Wheezy, Outtatown, BabyWave", plugin: "Little Labs Voice of God (analogue, on the 808)",
    preset: null, role: "808 low end", confidence: "engineer",
    quote: "is an analogue Little Labs Voice of God effect on an 808", quoteBy: "Bainz, engineer", source: SOS_SKI, sketch: "Glide 808",
  },

  // ---- Press and reference pages
  {
    song: "Alright (Super Bowl LIX performance)", artist: "Kendrick Lamar", producer: "Pharrell Williams (original)", plugin: "Spectrasonics Omnisphere",
    preset: "Jazz Stacks", role: "The stacked vocal chords", confidence: "press",
    quote: "The vocal sounds you're hearing here were created with Omnisphere's Jazz Stacks preset", quoteBy: "Matt Mullen, MusicRadar (by ear)", source: MR_KENDRICK, sketch: "Choir pad",
  },
  {
    song: "Presidential", artist: "Rick Ross", producer: "Pharrell Williams", plugin: "Spectrasonics Omnisphere",
    preset: "Jazz Stacks", role: "Vocal chord stack", confidence: "press",
    quote: "he used it previously in a beat for Rick Ross, on the 2012 track Presidential", quoteBy: "MusicRadar; the KTT2 thread lists it as \"Jazz Stacks Dah-Dat\"", source: MR_KENDRICK, sketch: "Choir pad",
  },
  {
    song: "XO Tour Llif3", artist: "Lil Uzi Vert", producer: "TM88, JW Lucas", plugin: "FL Studio Gross Beat (effect)",
    preset: null, role: "Volume and time chops on the whole beat", confidence: "press",
    quote: "the FL Studio plugin Gross Beat to manipulate the volume and the time of the instrumental", quoteBy: "Wikipedia, citing a 2017 Rap-Up interview", source: WIKI_XO, sketch: "Plugg bell",
  },

  // ---- Community reported (KTT2 thread and an upload description), unverified
  {
    song: "XO Tour Llif3", artist: "Lil Uzi Vert", producer: "TM88, JW Lucas", plugin: "Tone2 ElectraX",
    preset: null, role: "Melody", confidence: "community",
    quote: "Tone2 ElectraX presets here", quoteBy: "Description of a YouTube upload titled as TM88's original beat; no preset named", source: YT_XO, sketch: "Plugg bell",
  },
  { song: "I Don't Like", artist: "Chief Keef", producer: "Young Chop", plugin: "reFX Nexus", preset: "Hands Up Bells 3", path: "Plucked", role: "Bells", confidence: "community", source: KTT2, sketch: "Plugg bell" },
  { song: "Love Sosa", artist: "Chief Keef", producer: "Young Chop", plugin: "Tone2 Gladiator", preset: "PA 60dub JC", path: "Pads", role: "Pad", confidence: "community", source: KTT2, sketch: "Choir pad" },
  { song: "Honest", artist: "Future", producer: "Metro Boomin", plugin: "reFX Nexus", preset: "LD Crying Female", path: "XP Psytrance", role: "Vocal lead", confidence: "community", source: KTT2, sketch: "Choir pad" },
  { song: "Monster", artist: "Future", producer: "Metro Boomin", plugin: "reFX Nexus", preset: "Whistling Sines; Flute Highland", path: "Arpeggios; XP Dance Orchestra", role: "Whistle and flute", confidence: "community", source: KTT2, sketch: "Whistle lead" },
  { song: "Same Damn Time", artist: "Future", producer: "Sonny Digital", plugin: "reFX Nexus", preset: "DRZA PortaSynth", path: "DRZA XP Vol. 1", role: "Lead", confidence: "community", source: KTT2, sketch: "Whistle lead" },
  { song: "Birthday Song", artist: "2 Chainz feat. Kanye West", producer: "Sonny Digital", plugin: "reFX Nexus", preset: "DRZA PortaSynth", path: "DRZA XP Vol. 1", role: "Lead", confidence: "community", source: KTT2, sketch: "Whistle lead" },
  { song: "Tuesday", artist: "ILOVEMAKONNEN", producer: "Sonny Digital", plugin: "reFX Nexus", preset: "Chillzone 1", path: "Fantasy & Dream", role: "Main synth", confidence: "community", source: KTT2, sketch: "Choir pad" },
  { song: "56 Nights", artist: "Future", producer: "Southside", plugin: "Tone2 Electra2", preset: "Chosen Paths BN", path: "Keys", role: "Keys", confidence: "community", source: KTT2, sketch: "Dark keys" },
  { song: "No Lie", artist: "2 Chainz feat. Drake", producer: "Mike WiLL Made-It", plugin: "Tone2 Gladiator", preset: "SY Ethereal", path: "Synth", role: "Main synth", confidence: "community", source: KTT2, sketch: "Vapor brass" },
  { song: "No Type", artist: "Rae Sremmurd", producer: "Mike WiLL Made-It", plugin: "Tone2 Gladiator", preset: "Autochord", path: "Tutorial", role: "Chords", confidence: "community", source: KTT2, sketch: "Pluck house" },
  { song: "What They Want", artist: "ScHoolboy Q feat. 2 Chainz", producer: "Mike WiLL Made-It", plugin: "reFX Nexus", preset: "Chillin House Lounge 3", path: "XP House Vol. 1", role: "Keys", confidence: "community", source: KTT2, sketch: "Dark keys" },
  { song: "Up Down (Do This All Day)", artist: "T-Pain feat. B.o.B", producer: "DJ Mustard", plugin: "reFX Nexus; Tone2 Gladiator", preset: "PL 80's BalladBell; GT Fantasy MSC", path: "Plucked; DanceTrance2", role: "Bell and guitar-ish lead", confidence: "community", source: KTT2, sketch: "Plugg bell" },
  { song: "IDFWU", artist: "Big Sean feat. E-40", producer: "DJ Mustard", plugin: "reFX Nexus", preset: "PL VZ Bells 1 (first oscillator off)", path: "Plucked", role: "Bells", confidence: "community", source: KTT2, sketch: "Plugg bell" },
  { song: "Left, Right", artist: "YG", producer: "DJ Mustard", plugin: "reFX Nexus", preset: "PL The Hit", path: "XP ROM", role: "Stab", confidence: "community", source: KTT2, sketch: "Pluck house" },
  { song: "The Box", artist: "Roddy Ricch", producer: "30 Roc, Datboisqueeze", plugin: "Roland SRX Orchestra", preset: "PR-A 114 DawnSynphony; PR-B 033 FluteAtm/Aft", role: "The squeak-like lead and flute", confidence: "community", source: KTT2, sketch: "Whistle lead" },
  { song: "Let It Go", artist: "Playboi Carti", producer: "Pi'erre Bourne", plugin: "Not stated", preset: "Walk of Fame Lead", role: "Lead", confidence: "community", source: KTT2, sketch: "Whistle lead" },
  { song: "Long Time", artist: "Playboi Carti", producer: "Art Dealer", plugin: "Not stated", preset: "Broken Saw Lead", role: "Lead", confidence: "community", source: KTT2, sketch: "Rage supersaw" },
  { song: "The Hills", artist: "The Weeknd", producer: "Illangelo, Emmanuel Nickerson", plugin: "Spectrasonics Omnisphere 2", preset: "Bad Photocopy of a Supersaw", role: "Supersaw", confidence: "community", source: KTT2, sketch: "Rage supersaw" },
  { song: "H•A•M", artist: "Jay-Z & Kanye West", producer: "Lex Luger", plugin: "Tone2 Gladiator", preset: "ATM Tripping Alien", path: "Atmos", role: "Atmosphere", confidence: "community", source: KTT2, sketch: "Choir pad" },
  { song: "Look at Me Now", artist: "Chris Brown feat. Lil Wayne & Busta Rhymes", producer: "Diplo, Afrojack", plugin: "reFX Nexus", preset: "AR Roman Wing", path: "Hands Up Electro 2", role: "Arp", confidence: "community", source: KTT2, sketch: "Pluck house" },
  { song: "Drunk in Love", artist: "Beyoncé feat. Jay-Z", producer: "Detail and others", plugin: "reFX Nexus; Voice of Passion", preset: "AR String Runs; Syria (up an octave)", path: "Arpeggiatto", role: "String runs and vocal", confidence: "community", source: KTT2, sketch: "Choir pad" },
  { song: "The Real Slim Shady", artist: "Eminem", producer: "Dr. Dre, Mel-Man", plugin: "Korg Triton", preset: "B056 HarpsyKorg 8'+4'", path: "Bank INT-B", role: "Harpsichord", confidence: "community", source: KTT2, sketch: "Pluck house" },
  { song: "Grindin'", artist: "Clipse", producer: "The Neptunes", plugin: "Korg Triton", preset: "B116 Percussion Kit", path: "Drums", role: "Drums", confidence: "community", source: KTT2, sketch: "Glide 808" },
  { song: "Yonkers", artist: "Tyler, the Creator", producer: "Tyler, the Creator", plugin: "Reason (Thor, Redrum)", preset: "Gangsta Lead 1; Fx3_Hard&Soft kit", role: "Lead and drums", confidence: "community", source: KTT2, sketch: "Vapor brass" },
];

/**
 * Rows gathered in the second research pass (found.json): each one read from the linked page, with
 * a verbatim quote where the page gave one. Merged after the hand-written rows; a row for the same
 * song, preset and plugin as an earlier one is dropped.
 */
const seen = new Set<string>();
const flat = (x: string) => x.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
// A named preset is one row per song, however the plugin is spelled ("Kontakt (Factory Library)" vs "Kontakt Factory Library").
const keyOf = (p: PresetEntry) => (p.preset ? `${flat(p.song)}|${flat(p.preset)}` : [flat(p.song), flat(p.plugin), flat(p.role)].join("|"));
export const PRESETS: PresetEntry[] = [...HAND, ...(found as unknown as PresetEntry[])].filter((p) => {
  const k = keyOf(p);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

/** Every page a row links to, once each. */
export const SOURCES_READ: Source[] = [...new Map(PRESETS.map((p) => [p.source.url, p.source])).values()].sort((a, b) => a.label.localeCompare(b.label));
