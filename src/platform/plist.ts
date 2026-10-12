// Minimal reader for the XML property lists printed by macOS tools (diskutil -plist, ioreg -a).

export type PlistValue = string | number | boolean | Date | Buffer | PlistValue[] | { [key: string]: PlistValue };

const TOKEN = /<(\/?)([A-Za-z]+)\s*(\/?)>|<\?[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->|([^<]+)/g;

function unescape(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (named[e.toLowerCase()]) return named[e.toLowerCase()];
    return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

export function parsePlist(xml: string): PlistValue | undefined {
  type Frame = { tag: string; value: PlistValue[] | Record<string, PlistValue>; key?: string };
  const stack: Frame[] = [];
  let text = "";
  let result: PlistValue | undefined;

  const add = (value: PlistValue) => {
    const top = stack[stack.length - 1];
    if (!top) {
      result = value;
    } else if (Array.isArray(top.value)) {
      top.value.push(value);
    } else if (top.key !== undefined) {
      top.value[top.key] = value;
      top.key = undefined;
    }
  };

  for (const match of xml.matchAll(TOKEN)) {
    const [, closing, tag, selfClosing, chars] = match;
    if (chars !== undefined) {
      text += chars;
      continue;
    }
    if (!tag) continue;
    if (tag === "plist") continue;
    if (!closing && !selfClosing) {
      if (tag === "dict") stack.push({ tag, value: {} });
      else if (tag === "array") stack.push({ tag, value: [] });
      text = "";
      continue;
    }
    if (selfClosing) {
      if (tag === "true") add(true);
      else if (tag === "false") add(false);
      else if (tag === "dict") add({});
      else if (tag === "array") add([]);
      else if (tag === "string") add("");
      continue;
    }
    const value = unescape(text);
    text = "";
    switch (tag) {
      case "dict":
      case "array": {
        const frame = stack.pop();
        if (frame) add(frame.value);
        break;
      }
      case "key": {
        const top = stack[stack.length - 1];
        if (top && !Array.isArray(top.value)) top.key = value;
        break;
      }
      case "string": add(value); break;
      case "integer": add(Number(value.trim())); break;
      case "real": add(Number(value.trim())); break;
      case "date": add(new Date(value.trim())); break;
      case "data": add(Buffer.from(value.replace(/\s+/g, ""), "base64")); break;
    }
  }
  return result;
}

export function dict(value: PlistValue | undefined): Record<string, PlistValue> {
  return value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value)
    ? (value as Record<string, PlistValue>) : {};
}

export function list(value: PlistValue | undefined): PlistValue[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: PlistValue | undefined): string {
  return typeof value === "string" ? value : "";
}
