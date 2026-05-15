/**
 * NotificationToast.tsx - Toast notification component
 *
 * Renders individual toast notifications with enter/exit animations.
 * Supports: success, error, warning, info types with distinct colors and icons.
 */

import { useEffect, useRef } from "react";
import type { Notification, NotificationType } from "../stores/notificationStore.ts";
import { useNotificationStore } from "../stores/notificationStore.ts";

// ============== Icon per type ==============

const TYPE_ICONS: Record<NotificationType, string> = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
};

const TYPE_COLORS: Record<NotificationType, string> = {
  success: "bg-green-50 border-green-400 text-green-900",
  error: "bg-red-50 border-red-400 text-red-900",
  warning: "bg-yellow-50 border-yellow-400 text-yellow-900",
  info: "bg-blue-50 border-blue-400 text-blue-900",
};

const TYPE_ICON_BG: Record<NotificationType, string> = {
  success: "bg-green-100",
  error: "bg-red-100",
  warning: "bg-yellow-100",
  info: "bg-blue-100",
};

// ============== Individual Toast ==============

interface ToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

function Toast({ notification, onDismiss }: ToastProps) {
  const { id, type, title, message } = notification;
  const toastRef = useRef<HTMLDivElement>(null);

  // Slide in from right on mount
  useEffect(() => {
    const el = toastRef.current;
    if (!el) return;
    el.style.transform = "translateX(100%)";
    el.style.opacity = "0";

    requestAnimationFrame(() => {
      el.style.transition = "transform 300ms ease-out, opacity 300ms ease-out";
      el.style.transform = "translateX(0)";
      el.style.opacity = "1";
    });
  }, []);

  const handleDismiss = () => {
    const el = toastRef.current;
    if (!el) {
      onDismiss(id);
      return;
    }
    // Fade out on dismiss
    el.style.transition = "opacity 200ms ease-out, transform 200ms ease-out";
    el.style.opacity = "0";
    el.style.transform = "translateX(100%)";
    setTimeout(() => onDismiss(id), 200);
  };

  return (
    <div
      ref={toastRef}
      className={`flex items-start gap-3 p-4 rounded-lg border shadow-lg max-w-sm w-full ${TYPE_COLORS[type]}`}
      role="alert"
    >
      {/* Icon */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base ${TYPE_ICON_BG[type]}`}
      >
        {TYPE_ICONS[type]}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm leading-tight">{title}</p>
        {message && (
          <p className="text-xs opacity-80 mt-1 leading-relaxed">{message}</p>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity text-lg leading-none p-1 rounded hover:bg-black/5"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

// ============== Toast Container ==============

export function NotificationToastContainer() {
  const { notifications, removeNotification } = useNotificationStore();

  if (notifications.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {notifications.map((notification) => (
        <div key={notification.id} className="pointer-events-auto">
          <Toast
            notification={notification}
            onDismiss={removeNotification}
          />
        </div>
      ))}
    </div>
  );
}

// ============== Notification History Panel ==============

export function NotificationHistoryPanel() {
  const { history, isPanelOpen, closePanel, clearHistory } = useNotificationStore();

  if (!isPanelOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={closePanel}
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-80 bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-base">Notification History</h2>
          <div className="flex gap-2">
            <button
              onClick={clearHistory}
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              Clear
            </button>
            <button
              onClick={closePanel}
              className="text-lg opacity-60 hover:opacity-100"
              aria-label="Close panel"
            >
              ×
            </button>
          </div>
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto p-4">
          {history.length === 0 ? (
            <p className="text-sm text-gray-500 text-center mt-8">No notifications yet</p>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((notification) => (
                <div
                  key={notification.id}
                  className={`flex items-start gap-2 p-3 rounded text-sm border ${TYPE_COLORS[notification.type].replace("bg-", "bg-opacity-10 bg-")}`}
                >
                  <span className="text-base">{TYPE_ICONS[notification.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{notification.title}</p>
                    {notification.message && (
                      <p className="text-xs opacity-70 mt-0.5">{notification.message}</p>
                    )}
                    <p className="text-xs opacity-50 mt-1">
                      {new Date(notification.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t text-center">
          <p className="text-xs text-gray-400">
            Showing last {history.length} of 50 entries
          </p>
        </div>
      </div>
    </div>
  );
}

// ============== Sidebar toggle button helper ==============

export function NotificationHistoryButton() {
  const { togglePanel } = useNotificationStore();
  return (
    <button
      onClick={togglePanel}
      className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 text-sm text-gray-700"
      title="Notification history"
    >
      <span>🔔</span>
      <span>History</span>
    </button>
  );
}