// Image helpers for the artwork tools: PNG conversion and resizing in the browser, file picking, and confirmations.

import { $, store, model } from "./core.js";

/** Longest side choices for uploaded and shrunk images, the screen's own marked; 0 keeps the original size. */
export const maxSides = () => {
  const screen = Math.max(...model().screen);
  return [480, 640, 720, 800, 1024, 1280].map((v) => [v, `${v} px${v === screen ? " (the screen)" : ""}`]).concat([[0, "Original size"]]);
};
export const artMax = {
  get: () => {
    const v = store.get("artMax", Math.max(...model().screen));
    return v === 1000 ? 1024 : v;
  },
  set: (v) => store.set("artMax", +v)
};

/** A File, Blob or same-origin URL as base64 PNG, scaled down to maxSide when bigger. */
export async function pngData(source, maxSide = 0) {
  const blob = typeof source === "string" ? await (await fetch(source, { cache: "no-store" })).blob() : source;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("The browser could not read that image.");
  }
  const scale = maxSide && Math.max(bitmap.width, bitmap.height) > maxSide ? maxSide / Math.max(bitmap.width, bitmap.height) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the converted image."));
    reader.readAsDataURL(png);
  });
  return { data: String(url).slice(String(url).indexOf(",") + 1), width: canvas.width, height: canvas.height, size: png.size };
}

/** Asks for one image file; resolves to the File or null. */
export function pickImage() {
  const input = $("art-file");
  input.value = "";
  return new Promise((resolve) => {
    const done = () => { input.removeEventListener("change", done); window.removeEventListener("focus", later); resolve(input.files[0] || null); };
    const later = () => setTimeout(() => { if (!input.files.length) { input.removeEventListener("change", done); window.removeEventListener("focus", later); resolve(null); } }, 400);
    input.addEventListener("change", done);
    window.addEventListener("focus", later, { once: true });
    input.click();
  });
}

/** The image file in a drop event, or null. */
export function droppedImage(e) {
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
  return file || null;
}

/** A yes/no question in a dialog. html is trusted markup. */
export function confirmBox({ title, html, ok = "OK", danger = false }) {
  const dialog = $("confirm");
  $("c-title").textContent = title;
  $("c-body").innerHTML = html;
  $("c-ok").textContent = ok;
  $("c-ok").className = danger ? "btn danger-solid" : "btn primary";
  return new Promise((resolve) => {
    const finish = (answer) => {
      $("c-ok").onclick = $("c-cancel").onclick = dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    $("c-ok").onclick = () => finish(true);
    $("c-cancel").onclick = () => finish(false);
    dialog.onclose = () => finish(false);
    dialog.showModal();
  });
}
