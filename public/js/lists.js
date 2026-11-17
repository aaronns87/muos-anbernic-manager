// Favourites (browser store) and smart-list matching for Games.

import { store } from "./core.js";

const FAV_KEY = "favourites";

export const SMART_LISTS = [
  ["all", "Smart lists"],
  ["fav", "Favourites"],
  ["never", "Never copied"],
  ["no-art", "No art"],
  ["bad", "Bad dump"],
  ["tuning", "Needs tuning"],
  ["device-only", "On device only"],
];

export function favouriteKeys() {
  const raw = store.get(FAV_KEY, []);
  return new Set(Array.isArray(raw) ? raw.map(String) : []);
}

export function isFavourite(key) {
  return favouriteKeys().has(key);
}

export function toggleFavourite(key) {
  const fav = favouriteKeys();
  if (fav.has(key)) fav.delete(key);
  else fav.add(key);
  store.set(FAV_KEY, [...fav]);
  return fav.has(key);
}

/** Whether a Roms/ library game passes the current smart-list filter. */
export function matchLibrarySmartList(g, sys, ui, device, flags, keyOf, isOnCard, excluded) {
  const key = keyOf(sys, g);
  const list = ui.smartList;
  if (list === "fav" && !isFavourite(key)) return false;
  if (list === "never") {
    if (!device?.target || excluded.has(sys.code) || isOnCard(sys, g)) return false;
  } else if (list === "no-art" && g.i) return false;
  else if (list === "bad" && !flags?.bad?.has(key)) return false;
  else if (list === "tuning" && !flags?.tuning?.has(key)) return false;
  else if (list === "device-only") return false;
  return true;
}

/** Smart-list filter on the device games list (On device view). */
export function matchDeviceSmartList(g, libKey, ui, isFavouriteFn = isFavourite) {
  const list = ui.smartList;
  if (list === "fav" && !isFavouriteFn(libKey)) return false;
  if (list === "device-only" && g.st !== "device") return false;
  if (list !== "all" && list !== "fav" && list !== "device-only") return false;
  return true;
}

/** Optional companion filters when a smart list is chosen. */
export function applySmartListSideEffects(ui, hasTarget, setWhere) {
  if (ui.smartList === "never" && hasTarget) ui.onCard = "missing";
  if (ui.smartList === "no-art") ui.art = "without";
  if (ui.smartList === "device-only" && hasTarget) setWhere?.("device", false);
}