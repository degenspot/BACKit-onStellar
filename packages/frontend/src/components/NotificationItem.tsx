import { Notification } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

const TYPE_ICONS: Record<Notification["type"], React.ReactNode> = {
    BACKED_CALL: <span className="text-blue-500">📊</span>, // Stake Update
    CALL_ENDED: <span className="text-yellow-500">🎯</span>, // Call Resolved
    PAYOUT_READY: <span className="text-green-500">💰</span>,
    NEW_FOLLOWER: <span className="text-purple-500">👤</span>,
};

function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

interface Props {
    notification: Notification;
    onMarkRead: (id: number) => void;
}

export function NotificationItem({ notification, onMarkRead }: Props) {
    const router = useRouter();

    // Determine route based on notification type
    const handleClick = () => {
        if (!notification.readStatus) onMarkRead(notification.id);
        switch (notification.type) {
            case "CALL_ENDED":
            case "BACKED_CALL":
                if (notification.referenceId) {
                    router.push(`/calls/${notification.referenceId}`);
                }
                break;
            case "NEW_FOLLOWER":
                if (notification.address) {
                    router.push(`/profile/${notification.address}`);
                }
                break;
            case "PAYOUT_READY":
                router.push(`/leaderboard`);
                break;
            default:
                break;
        }
    };

    return (
        <div
            className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer ${!notification.readStatus ? "bg-blue-50" : ""}`}
            onClick={handleClick}
        >
            <div className="mt-0.5 shrink-0">
                {TYPE_ICONS[notification.type] ?? <Bell className="w-4 h-4 text-gray-400" />}
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-sm ${notification.readStatus ? "text-gray-600" : "text-gray-900 font-medium"}`}>{notification.message}</p>
                <p className="text-xs text-gray-400 mt-0.5">{timeAgo(notification.createdAt)}</p>
            </div>
            {!notification.readStatus && <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />}
        </div>
    );
}
