import { io, Socket } from 'socket.io-client';
import {
  SocketEventName,
  SocketEventEnvelope,
  SubscribeJobPayload,
  UnsubscribeJobPayload,
  SubscribeQueuePayload,
  UnsubscribeQueuePayload,
} from '@taskflow/shared';

export type SocketStatusListener = (status: {
  connected: boolean;
  reconnecting: boolean;
  error: string | null;
}) => void;

export class SocketService {
  private static instance: SocketService;
  private socket: Socket | null = null;
  private subscribedJobs = new Set<string>();
  private subscribedQueues = new Set<string>();
  private isAdminSubscribed = false;
  private statusListeners = new Set<SocketStatusListener>();
  private reconnecting = false;
  private lastError: string | null = null;

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }

  public isReconnecting(): boolean {
    return this.reconnecting;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Connects to the Socket.io server with the provided JWT access token.
   */
  public connect(token: string): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;

    this.socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.reconnecting = false;
      this.lastError = null;
      this.notifyStatusListeners();

      // Automatically restore existing room subscriptions after reconnect
      this.restoreSubscriptions();
    });

    this.socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // The disconnection was initiated by the server, reconnect manually
        this.socket?.connect();
      }
      this.notifyStatusListeners();
    });

    this.socket.on('connect_error', (err) => {
      this.lastError = err.message;
      this.reconnecting = true;
      this.notifyStatusListeners();
    });

    this.socket.io.on('reconnect_attempt', () => {
      this.reconnecting = true;
      this.notifyStatusListeners();
    });

    this.socket.io.on('reconnect', () => {
      this.reconnecting = false;
      this.lastError = null;
      this.notifyStatusListeners();
    });

    this.socket.io.on('reconnect_failed', () => {
      this.reconnecting = false;
      this.lastError = 'Connection failed after maximum retry attempts';
      this.notifyStatusListeners();
    });

    return this.socket;
  }

  /**
   * Disconnects the socket cleanly and clears tracked rooms.
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.subscribedJobs.clear();
    this.subscribedQueues.clear();
    this.isAdminSubscribed = false;
    this.reconnecting = false;
    this.lastError = null;
    this.notifyStatusListeners();
  }

  /**
   * Subscribes to events for a specific job.
   */
  public async subscribeJob(jobId: string): Promise<boolean> {
    this.subscribedJobs.add(jobId);
    if (!this.socket?.connected) {
      return false;
    }

    return new Promise((resolve) => {
      const payload: SubscribeJobPayload = { jobId };
      this.socket!.emit('subscribe:job', payload, (res?: { success?: boolean }) => {
        resolve(res?.success || false);
      });
    });
  }

  /**
   * Unsubscribes from events for a specific job.
   */
  public unsubscribeJob(jobId: string): void {
    this.subscribedJobs.delete(jobId);
    if (this.socket?.connected) {
      const payload: UnsubscribeJobPayload = { jobId };
      this.socket.emit('unsubscribe:job', payload);
    }
  }

  /**
   * Subscribes to queue depth and metrics events.
   */
  public async subscribeQueue(queueName: string): Promise<boolean> {
    this.subscribedQueues.add(queueName);
    if (!this.socket?.connected) {
      return false;
    }

    return new Promise((resolve) => {
      const payload: SubscribeQueuePayload = { queueName };
      this.socket!.emit('subscribe:queue', payload, (res?: { success?: boolean }) => {
        resolve(res?.success || false);
      });
    });
  }

  /**
   * Unsubscribes from queue metrics events.
   */
  public unsubscribeQueue(queueName: string): void {
    this.subscribedQueues.delete(queueName);
    if (this.socket?.connected) {
      const payload: UnsubscribeQueuePayload = { queueName };
      this.socket.emit('unsubscribe:queue', payload);
    }
  }

  /**
   * Subscribes to operational admin telemetry.
   */
  public async subscribeAdminTelemetry(): Promise<boolean> {
    this.isAdminSubscribed = true;
    if (!this.socket?.connected) {
      return false;
    }

    return new Promise((resolve) => {
      this.socket!.emit('subscribe:admin:telemetry', (res?: { success?: boolean }) => {
        resolve(res?.success || false);
      });
    });
  }

  /**
   * Registers a typed event listener for Socket.io events.
   */
  public on<T = unknown>(
    event: SocketEventName | string,
    listener: (envelope: SocketEventEnvelope<T>) => void
  ): void {
    if (!this.socket) return;
    this.socket.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Removes an event listener.
   */
  public off<T = unknown>(
    event: SocketEventName | string,
    listener: (envelope: SocketEventEnvelope<T>) => void
  ): void {
    if (!this.socket) return;
    this.socket.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Subscribes to connection status changes.
   */
  public onStatusChange(listener: SocketStatusListener): () => void {
    this.statusListeners.add(listener);
    // Send immediate snapshot
    listener({
      connected: this.isConnected(),
      reconnecting: this.isReconnecting(),
      error: this.lastError,
    });
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private notifyStatusListeners(): void {
    const status = {
      connected: this.isConnected(),
      reconnecting: this.isReconnecting(),
      error: this.lastError,
    };
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  /**
   * Restores active room subscriptions following a reconnection event.
   */
  private restoreSubscriptions(): void {
    if (!this.socket?.connected) return;

    for (const jobId of this.subscribedJobs) {
      const payload: SubscribeJobPayload = { jobId };
      this.socket.emit('subscribe:job', payload);
    }

    for (const queueName of this.subscribedQueues) {
      const payload: SubscribeQueuePayload = { queueName };
      this.socket.emit('subscribe:queue', payload);
    }

    if (this.isAdminSubscribed) {
      this.socket.emit('subscribe:admin:telemetry');
    }
  }
}

export const socketService = SocketService.getInstance();
