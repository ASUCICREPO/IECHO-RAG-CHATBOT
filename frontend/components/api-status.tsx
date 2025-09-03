"use client"

interface ApiStatusProps {
  status: 'loading' | 'online' | 'offline' | 'error';
}

export default function ApiStatus({ status }: ApiStatusProps) {
  const statusConfig = {
    loading: { text: 'Connecting...', color: 'bg-yellow-500' },
    online: { text: 'Online', color: 'bg-green-500' },
    offline: { text: 'Offline', color: 'bg-gray-500' },
    error: { text: 'Connection Error', color: 'bg-red-500' }
  };

  const { text, color } = statusConfig[status] || statusConfig.offline;

  return (
    <div className="flex items-center text-xs text-gray-600 dark:text-gray-400">
      <span className="mr-2">API Status:</span>
      <span className={`inline-block w-2 h-2 rounded-full ${color} mr-1`}></span>
      <span>{text}</span>
    </div>
  );
}