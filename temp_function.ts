export async function getABTestSummary(env: Env, days: number = 7): Promise<any> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceStr = since.toISOString();

  const [byProvider, dualSendRows, totalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT provider,
              COUNT(*) as requests,
              AVG(latency_ms) as avg_latency_ms,
              AVG(transcript_length) as avg_transcript_length,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
              SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) as fallbacks,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
       FROM transcription_ab_test WHERE timestamp >= ?
       GROUP BY provider`
    ).bind(sinceStr).all(),

    env.DB.prepare(
      `SELECT provider, comparison_provider,
              AVG(latency_ms) as primary_avg_latency,
              AVG(comparison_latency_ms) as comparison_avg_latency,
              AVG(transcript_length) as primary_avg_length,
              AVG(comparison_transcript_length) as comparison_avg_length,
              COUNT(*) as dual_send_count
       FROM transcription_ab_test
       WHERE comparison_provider IS NOT NULL AND timestamp >= ?
       GROUP BY provider, comparison_provider`
    ).bind(sinceStr).all(),

    env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(estimated_duration_s) as total_audio_seconds
       FROM transcription_ab_test WHERE timestamp >= ?`
    ).bind(sinceStr).first(),
  ]);

  return {
    range_days: days,
    total_requests: totalRow?.total ?? 0,
    total_audio_hours: Math.round(((totalRow as any)?.total_audio_seconds ?? 0) / 3600 * 10) / 10,
    by_provider: byProvider.results ?? [],
    dual_send_comparisons: dualSendRows.results ?? [],
  };
}
