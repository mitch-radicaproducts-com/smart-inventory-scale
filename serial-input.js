// Turns scale bytes into text and Enter actions. CR and LF are one Enter.
// A bare number is typed as received. No unit is added.

export function isTextBytes(bytes) {
  if (!bytes.length) return true;
  let noisy = 0;
  for (const byte of bytes) {
    if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) noisy += 1;
  }
  return noisy / bytes.length <= 0.4;
}

export function createScaleFeed() {
  let pending = "";

  function takeEnter() {
    const actions = [];
    while (pending.startsWith("\r") || pending.startsWith("\n")) {
      const first = pending[0];
      pending = pending.slice(1);
      if (first === "\r" && pending.startsWith("\n")) pending = pending.slice(1);
      if (first === "\n" && pending.startsWith("\r")) pending = pending.slice(1);
      actions.push({ type: "enter" });
    }
    return actions;
  }

  return function push(chunk) {
    pending += chunk;
    const actions = takeEnter();
    while (pending.length) {
      const cr = pending.indexOf("\r");
      const lf = pending.indexOf("\n");
      const cut = cr >= 0 && lf >= 0 ? Math.min(cr, lf) : Math.max(cr, lf);
      if (cut === -1) {
        actions.push({ type: "text", text: pending });
        pending = "";
        break;
      }
      if (cut > 0) actions.push({ type: "text", text: pending.slice(0, cut) });
      pending = pending.slice(cut);
      actions.push(...takeEnter());
    }
    return actions;
  };
}
