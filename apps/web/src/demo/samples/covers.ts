import ROWS from "./covers.json";
import { registerCovers, type LazyCover } from "../presets/cover";

/**
 * The Samples tab's album covers (songs that sample, and the records they sample), found by
 * scripts/find-demo-covers.py. They load with the tab, not with the page: importing this module
 * adds them to coverFor().
 */
registerCovers(ROWS as unknown as Record<string, LazyCover>);
