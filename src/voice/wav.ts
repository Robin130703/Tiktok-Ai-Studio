/**
 * Dauer einer WAV-Datei (PCM) aus dem Header. Die Länge der Daten wird aus der
 * Puffergröße bestimmt, falls der Header sie nicht verlässlich angibt (Streaming).
 */
export function wavDurationSeconds(buf: Buffer): number {
  if (
    buf.length < 44 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Audio ist keine gültige WAV-Datei");
  }
  let pos = 12;
  let byteRate = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      byteRate = buf.readUInt32LE(pos + 16);
    } else if (id === "data") {
      if (byteRate <= 0) throw new Error("WAV-Header ohne fmt-Block");
      const available = buf.length - (pos + 8);
      const bytes = size === 0 || size > available ? available : size;
      return bytes / byteRate;
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error("WAV-Datei ohne Daten-Block");
}
