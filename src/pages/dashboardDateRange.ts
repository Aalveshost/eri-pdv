function brToIso(br: string) {
  const parts = br.replace(/_/g, "").split("/");
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length < 4) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function isoToBr(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function getDashboardDefaultRange(todayIso: string) {
  const todayBr = isoToBr(todayIso);
  return {
    startBr: todayBr,
    endBr: todayBr,
  };
}

export function getDashboardRangeFromBr(startBr: string, endBr: string) {
  const startIso = brToIso(startBr);
  const endIso = brToIso(endBr);

  if (!startIso || !endIso) {
    return null;
  }

  if (startIso <= endIso) {
    return { start: startIso, end: endIso };
  }

  return { start: endIso, end: startIso };
}
