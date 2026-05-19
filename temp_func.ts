function processResults(results: ScreenpipeResult[]): {
  byApp: Record<string, string[]>;
  timeline: { time: string; app: string; text: string }[];
} {
  const byApp: Record<string, string[]> = {};
  const timeline: { time: string; app: string; text: string }[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    if (r.type !== "OCR") continue;
    const text = r.content.text?.trim();
    if (!text || text.length < 20) continue;

    // Dedupe similar content
    const hash = text.slice(0, 100);
    if (seen.has(hash)) continue;
    seen.add(hash);

    const app = r.content.app_name || "Unknown";
    byApp[app] = byApp[app] || [];
    byApp[app].push(text);

    timeline.push({
      time: r.content.timestamp,
      app,
      text: text.slice(0, 500),
    });
  }

  return { byApp, timeline };
}
