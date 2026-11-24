// A print fills a card only when the line itself names that value.
// A bare number stays raw. This scale does not send a separate unit.

export function interpretLine(line) {
  const raw = String(line).replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const parsed = {
    raw,
    weightText: null,
    piecesText: null,
    unitWeightText: null,
    stable: null,
    overload: false,
  };

  if (/^(?:over|overload)\b/i.test(raw) || /^OL\b/.test(raw)) {
    parsed.overload = true;
  }

  if (/\bUS\b/.test(raw)) parsed.stable = false;
  else if (/\bST\b/.test(raw)) parsed.stable = true;

  const unitWeight = raw.match(
    /(?:u\.?\s*w\.?|unit\s*wt\.?|unit\s*weight|piece\s*weight)\s*[:=]?\s*(?<![.\d])([+-]?\d+(?:\.\d+)?)(?:\s*(kg|g|lb|oz)\b)?/i,
  );
  if (unitWeight) {
    const unit = unitWeight[2] ? ` ${unitWeight[2].toLowerCase()}` : "";
    parsed.unitWeightText = `${unitWeight[1]}${unit}`;
  }

  const pieces = raw.match(
    /(?:\b(?:pcs|qty|quantity|count)\b\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)|([+-]?\d+(?:\.\d+)?)\s*(?:pcs|pieces)\b)/i,
  );
  if (pieces) parsed.piecesText = pieces[1] ?? pieces[2];

  if (!unitWeight) {
    const weight = raw.match(/(?<![.\d])([+-]?\d+(?:\.\d+)?)\s*(kg|g|lb|oz)\b/i);
    if (weight) parsed.weightText = `${weight[1]} ${weight[2].toLowerCase()}`;
  }

  return parsed;
}

export function createStreamParser() {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk;
      const parts = pending.split(/\r\n|\n|\r/);
      pending = parts.pop() ?? "";
      return parts.map((part) => interpretLine(part)).filter(Boolean);
    },
    reset() {
      pending = "";
    },
  };
}
