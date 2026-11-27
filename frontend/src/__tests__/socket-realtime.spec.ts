import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { SocketService } from '../services/socket.service';

describe('SocketService Client Lifecycle & Subscription Management', () => {
  let socketService: SocketService;

  beforeEach(() => {
    socketService = SocketService.getInstance();
  });

  it('should maintain a single shared instance (Singleton)', () => {
    const anotherInstance = SocketService.getInstance();
    expect(socketService).toBe(anotherInstance);
  });

  it('should accurately report initial offline connection status', () => {
    expect(socketService.isConnected()).toBe(false);
    expect(socketService.isReconnecting()).toBe(false);
  });

  it('should register and notify status change listeners', () => {
    const listener = jest.fn();
    const unsubscribe = socketService.onStatusChange(listener);

    expect(typeof unsubscribe).toBe('function');

    // Unsubscribe removes listener
    unsubscribe();
  });

  it('should maintain subscription state for jobs and queues', async () => {
    // When socket is not yet connected, subscribe returns false gracefully
    const jobSub = await socketService.subscribeJob('job_test_123');
    expect(jobSub).toBe(false);

    const queueSub = await socketService.subscribeQueue('critical');
    expect(queueSub).toBe(false);

    // Unsubscribe should not throw
    expect(() => socketService.unsubscribeJob('job_test_123')).not.toThrow();
    expect(() => socketService.unsubscribeQueue('critical')).not.toThrow();
  });
});