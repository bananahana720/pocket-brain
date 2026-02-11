const ANALYTICS_STORAGE_KEY = 'pocketbrain_analytics_events';

export type AnalyticsEventName =
  | 'daily_brief_share_clicked'
  | 'daily_brief_share_opened'
  | 'note_share_clicked'
  | 'note_share_completed';

interface AnalyticsEvent {
  name: AnalyticsEventName;
  timestamp: number;
  metadata?: Record<string, string | number | boolean>;
}

const readEvents = (): AnalyticsEvent[] => {
  try {
    const raw = localStorage.getItem(ANALYTICS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const trackEvent = (
  name: AnalyticsEventName,
  metadata?: Record<string, string | number | boolean>
) => {
  try {
    const events = readEvents();
    events.push({
      name,
      timestamp: Date.now(),
      ...(metadata ? { metadata } : {}),
    });
    localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Analytics is best-effort only.
  }
};
