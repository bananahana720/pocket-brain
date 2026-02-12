const ANALYTICS_STORAGE_KEY = 'pocketbrain_analytics_events';
const MAX_ANALYTICS_EVENTS = 200;

export type AnalyticsEventName =
  | 'daily_brief_share_clicked'
  | 'daily_brief_share_opened'
  | 'note_share_clicked'
  | 'note_share_completed'
  | 'note_share_opened'
  | 'note_share_imported'
  | 'graph_view_opened'
  | 'graph_node_focused'
  | 'backlink_open_graph_clicked';

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
    const nextEvent: AnalyticsEvent = {
      name,
      timestamp: Date.now(),
      ...(metadata ? { metadata } : {}),
    };
    const updatedEvents =
      events.length >= MAX_ANALYTICS_EVENTS
        ? [...events.slice(events.length - MAX_ANALYTICS_EVENTS + 1), nextEvent]
        : [...events, nextEvent];
    localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(updatedEvents));
  } catch {
    // Analytics is best-effort only.
  }
};
