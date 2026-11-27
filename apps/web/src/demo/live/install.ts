import { installMeterTap } from "./meter";

// Imported first by main.tsx, before anything can create an AudioContext, so every sound is metered.
installMeterTap();
