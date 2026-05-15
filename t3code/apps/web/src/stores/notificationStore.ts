/**
 * notificationStore.ts - Zustand store for toast notifications
 *
 * Manages notification state with auto-dismiss and history panel.
 * Supports: success, error, warning, info types.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly message?: string;
  readonly timestamp: number;
  readonly duration?: number; // ms, default 5000
}

export interface NotificationState {
  readonly notifications: Notification[];
  readonly history: Notification[];
  readonly isPanelOpen: boolean;
}

export interface NotificationActions {
  addNotification: (notification: Omit<Notification, "id" | "timestamp">) => string;
  removeNotification: (id: string) => void;
  clearHistory: () => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

const MAX_NOTIFICATIONS = 10;
const MAX_HISTORY = 50;

let idCounter = 0;
function generateId(): string {
  return `notif-${Date.now()}-${++idCounter}`;
}

export type NotificationStore = NotificationState & NotificationActions;

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set, get) => ({
      notifications: [],
      history: [],
      isPanelOpen: false,

      addNotification: (notification) => {
        const id = generateId();
        const fullNotification: Notification = {
          ...notification,
          id,
          timestamp: Date.now(),
          duration: notification.duration ?? 5000,
        };

        set((state) => ({
          notifications: [
            ...state.notifications.slice(-(MAX_NOTIFICATIONS - 1)),
            fullNotification,
          ],
          history: [fullNotification, ...state.history].slice(0, MAX_HISTORY),
        }));

        // Auto-dismiss
        const duration = fullNotification.duration ?? 5000;
        if (duration > 0) {
          setTimeout(() => {
            get().removeNotification(id);
          }, duration);
        }

        return id;
      },

      removeNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },

      clearHistory: () => {
        set({ history: [] });
      },

      openPanel: () => {
        set({ isPanelOpen: true });
      },

      closePanel: () => {
        set({ isPanelOpen: false });
      },

      togglePanel: () => {
        set((state) => ({ isPanelOpen: !state.isPanelOpen }));
      },
    }),
    {
      name: "t3code:notifications:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        history: state.history,
      }),
    },
  ),
);

// Convenience helpers for common notification patterns
export const notificationHelpers = {
  success: (title: string, message?: string) =>
    useNotificationStore.getState().addNotification({ type: "success", title, message }),

  error: (title: string, message?: string) =>
    useNotificationStore.getState().addNotification({ type: "error", title, message }),

  warning: (title: string, message?: string) =>
    useNotificationStore.getState().addNotification({ type: "warning", title, message }),

  info: (title: string, message?: string) =>
    useNotificationStore.getState().addNotification({ type: "info", title, message }),
};