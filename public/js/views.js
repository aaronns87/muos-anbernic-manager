// Redraws whichever section is showing.

import { section } from "./core.js";
import { render } from "./games.js";
import { renderOverview } from "./overview.js";
import { renderArtwork } from "./artwork-view.js";
import { renderTuning } from "./tuning.js";

export function renderCurrent() {
  const s = section();
  if (s === "games") render();
  else if (s === "artwork") renderArtwork();
  else if (s === "overview") renderOverview();
  else if (s === "tuning") renderTuning();
}
