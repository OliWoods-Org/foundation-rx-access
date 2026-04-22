import { z } from "zod";

export const AlertSeverity = z.enum(["info", "warning", "urgent", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

export const AlertChannel = z.enum(["sms", "email", "push", "whatsapp", "slack"]);
export type AlertChannel = z.infer<typeof AlertChannel>;

export const SmartAlert = z.object({
  id: z.string().uuid(),
  severity: AlertSeverity,
  title: z.string(),
  message: z.string(),
  channels: z.array(AlertChannel),
  recipientId: z.string(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.date(),
  acknowledgedAt: z.date().optional(),
  escalatedAt: z.date().optional(),
});
export type SmartAlert = z.infer<typeof SmartAlert>;

export const AlertRule = z.object({
  id: z.string().uuid(),
  name: z.string(),
  condition: z.string(),
  severity: AlertSeverity,
  channels: z.array(AlertChannel),
  cooldownMs: z.number().default(300000),
  enabled: z.boolean().default(true),
});
export type AlertRule = z.infer<typeof AlertRule>;

const alertHistory = new Map<string, SmartAlert[]>();

export function createAlert(rule: AlertRule, context: Record<string, unknown>): SmartAlert {
  const alert: SmartAlert = {
    id: crypto.randomUUID(),
    severity: rule.severity,
    title: rule.name,
    message: interpolateMessage(rule.condition, context),
    channels: rule.channels,
    recipientId: (context.recipientId as string) || "default",
    metadata: context,
    createdAt: new Date(),
  };
  const history = alertHistory.get(rule.id) || [];
  history.push(alert);
  alertHistory.set(rule.id, history);
  return alert;
}

export function shouldSuppress(ruleId: string, cooldownMs: number): boolean {
  const history = alertHistory.get(ruleId) || [];
  if (history.length === 0) return false;
  const last = history[history.length - 1]!;
  return Date.now() - last.createdAt.getTime() < cooldownMs;
}

export function getAlertHistory(ruleId: string): SmartAlert[] {
  return alertHistory.get(ruleId) || [];
}

function interpolateMessage(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(context[key] ?? key));
}
