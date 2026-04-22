import { z } from "zod";

export const TimeWindow = z.enum(["1h", "6h", "24h", "7d", "30d", "90d", "1y"]);
export type TimeWindow = z.infer<typeof TimeWindow>;

export const MetricType = z.enum(["counter", "gauge", "histogram", "rate"]);
export type MetricType = z.infer<typeof MetricType>;

export const Metric = z.object({
  name: z.string(),
  type: MetricType,
  value: z.number(),
  tags: z.record(z.string()).optional(),
  timestamp: z.date(),
});
export type Metric = z.infer<typeof Metric>;

export const TrendAnalysis = z.object({
  metric: z.string(),
  window: TimeWindow,
  direction: z.enum(["up", "down", "stable"]),
  changePercent: z.number(),
  dataPoints: z.number(),
  forecast: z.number().optional(),
  confidence: z.number().min(0).max(1),
});
export type TrendAnalysis = z.infer<typeof TrendAnalysis>;

export const ImpactReport = z.object({
  id: z.string().uuid(),
  period: TimeWindow,
  metrics: z.array(Metric),
  trends: z.array(TrendAnalysis),
  highlights: z.array(z.string()),
  generatedAt: z.date(),
});
export type ImpactReport = z.infer<typeof ImpactReport>;

const metricsStore: Metric[] = [];

export function recordMetric(name: string, value: number, type: MetricType = "gauge", tags?: Record<string, string>): Metric {
  const metric: Metric = { name, type, value, tags, timestamp: new Date() };
  metricsStore.push(metric);
  return metric;
}

export function analyzeTrend(metricName: string, window: TimeWindow): TrendAnalysis {
  const windowMs = parseWindow(window);
  const cutoff = new Date(Date.now() - windowMs);
  const points = metricsStore.filter(m => m.name === metricName && m.timestamp >= cutoff);
  
  if (points.length < 2) {
    return { metric: metricName, window, direction: "stable", changePercent: 0, dataPoints: points.length, confidence: 0 };
  }
  
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  const change = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
  const direction = change > 5 ? "up" : change < -5 ? "down" : "stable";
  
  return { metric: metricName, window, direction, changePercent: Math.round(change * 10) / 10, dataPoints: points.length, confidence: Math.min(points.length / 30, 1) };
}

export function generateImpactReport(window: TimeWindow): ImpactReport {
  const metricNames = [...new Set(metricsStore.map(m => m.name))];
  const trends = metricNames.map(name => analyzeTrend(name, window));
  const highlights = trends.filter(t => Math.abs(t.changePercent) > 10).map(t => `${t.metric}: ${t.direction} ${t.changePercent}%`);
  
  return {
    id: crypto.randomUUID(),
    period: window,
    metrics: metricsStore.slice(-100),
    trends,
    highlights,
    generatedAt: new Date(),
  };
}

function parseWindow(w: TimeWindow): number {
  const map: Record<TimeWindow, number> = { "1h": 3600000, "6h": 21600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000, "90d": 7776000000, "1y": 31536000000 };
  return map[w];
}
