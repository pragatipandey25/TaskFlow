import React, { createContext, useContext, useEffect, useState } from 'react';
import { socketService, SocketService } from '../services/socket.service';
import { useAuth } from './AuthContext';

interface SocketContextType {
  socket: SocketService;
  isConnected: boolean;
  isReconnecting: boolean;
  connectionError: string | null;
  subscribeJob: (jobId: string) => Promise<boolean>;
  unsubscribeJob: (jobId: string) => void;
  subscribeQueue: (queueName: string) => Promise<boolean>;
  unsubscribeQueue: (queueName: string) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { accessToken, isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState<boolean>(socketService.isConnected());
  const [isReconnecting, setIsReconnecting] = useState<boolean>(socketService.isReconnecting());
  const [connectionError, setConnectionError] = useState<string | null>(socketService.getLastError());

  // Listen for socket connection status changes
  useEffect(() => {
    const unsubscribe = socketService.onStatusChange((status) => {
      setIsConnected(status.connected);
      setIsReconnecting(status.reconnecting);
      setConnectionError(status.error);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Connect or disconnect whenever user session changes
  useEffect(() => {
    if (isAuthenticated && accessToken) {
      socketService.connect(accessToken);
    } else {
      socketService.disconnect();
    }

    return () => {
      // Disconnect when provider unmounts
      socketService.disconnect();
    };
  }, [isAuthenticated, accessToken]);

  const value: SocketContextType = {
    socket: socketService,
    isConnected,
    isReconnecting,
    connectionError,
    subscribeJob: (jobId: string) => socketService.subscribeJob(jobId),
    unsubscribeJob: (jobId: string) => socketService.unsubscribeJob(jobId),
    subscribeQueue: (queueName: string) => socketService.subscribeQueue(queueName),
    unsubscribeQueue: (queueName: string) => socketService.unsubscribeQueue(queueName),
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export function useSocket(): SocketContextType {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}
