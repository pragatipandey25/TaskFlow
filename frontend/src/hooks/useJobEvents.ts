import { useEffect, useState, useCallback } from 'react';
import {
  SocketEventName,
  SocketEventEnvelope,
  JobEventPayload,
  JobProgressPayload,
  JobStatus,
} from '@taskflow/shared';
import { useSocket } from '../context/SocketContext';

export interface UseJobEventsOptions {
  jobId?: string;
  onEvent?: (event: SocketEventEnvelope<JobEventPayload | JobProgressPayload>) => void;
  onProgress?: (progress: number, message?: string) => void;
  onStatusChange?: (status: JobStatus, payload: JobEventPayload) => void;
}

export function useJobEvents(options: UseJobEventsOptions = {}) {
  const { jobId, onEvent, onProgress, onStatusChange } = options;
  const { socket, isConnected, subscribeJob, unsubscribeJob } = useSocket();

  const [currentProgress, setCurrentProgress] = useState<number | null>(null);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<JobStatus | null>(null);
  const [lastEvent, setLastEvent] = useState<SocketEventEnvelope<JobEventPayload | JobProgressPayload> | null>(null);

  // Subscribe to room if specific jobId provided
  useEffect(() => {
    if (jobId && isConnected) {
      subscribeJob(jobId);
      return () => {
        unsubscribeJob(jobId);
      };
    }
  }, [jobId, isConnected, subscribeJob, unsubscribeJob]);

  // Handle Progress Event
  const handleProgress = useCallback(
    (envelope: SocketEventEnvelope<JobProgressPayload>) => {
      if (jobId && envelope.data.jobId !== jobId) return;

      setCurrentProgress(envelope.data.progress);
      if (envelope.data.message) {
        setCurrentMessage(envelope.data.message);
      }
      setLastEvent(envelope);

      if (onProgress) {
        onProgress(envelope.data.progress, envelope.data.message);
      }
      if (onEvent) {
        onEvent(envelope);
      }
    },
    [jobId, onProgress, onEvent]
  );

  // Handle Lifecycle Events
  const handleLifecycle = useCallback(
    (envelope: SocketEventEnvelope<JobEventPayload>) => {
      if (jobId && envelope.data.jobId !== jobId) return;

      setCurrentStatus(envelope.data.status);
      if (envelope.data.progress !== undefined) {
        setCurrentProgress(envelope.data.progress);
      }
      if (envelope.data.progressMessage) {
        setCurrentMessage(envelope.data.progressMessage);
      }
      setLastEvent(envelope);

      if (onStatusChange) {
        onStatusChange(envelope.data.status, envelope.data);
      }
      if (onEvent) {
        onEvent(envelope);
      }
    },
    [jobId, onStatusChange, onEvent]
  );

  useEffect(() => {
    socket.on<JobProgressPayload>(SocketEventName.JOB_PROGRESS, handleProgress);
    socket.on<JobEventPayload>(SocketEventName.JOB_SUBMITTED, handleLifecycle);
    socket.on<JobEventPayload>(SocketEventName.JOB_QUEUED, handleLifecycle);
    socket.on<JobEventPayload>(SocketEventName.JOB_STARTED, handleLifecycle);
    socket.on<JobEventPayload>(SocketEventName.JOB_RETRYING, handleLifecycle);
    socket.on<JobEventPayload>(SocketEventName.JOB_COMPLETED, handleLifecycle);
    socket.on<JobEventPayload>(SocketEventName.JOB_FAILED, handleLifecycle);
    socket.on<JobEventPayload>(SocketEventName.JOB_CANCELLED, handleLifecycle);
    socket.on<JobEventPayload>(SocketEventName.JOB_DEAD_LETTERED, handleLifecycle);

    return () => {
      socket.off<JobProgressPayload>(SocketEventName.JOB_PROGRESS, handleProgress);
      socket.off<JobEventPayload>(SocketEventName.JOB_SUBMITTED, handleLifecycle);
      socket.off<JobEventPayload>(SocketEventName.JOB_QUEUED, handleLifecycle);
      socket.off<JobEventPayload>(SocketEventName.JOB_STARTED, handleLifecycle);
      socket.off<JobEventPayload>(SocketEventName.JOB_RETRYING, handleLifecycle);
      socket.off<JobEventPayload>(SocketEventName.JOB_COMPLETED, handleLifecycle);
      socket.off<JobEventPayload>(SocketEventName.JOB_FAILED, handleLifecycle);
      socket.off<JobEventPayload>(SocketEventName.JOB_CANCELLED, handleLifecycle);
      socket.off<JobEventPayload>(SocketEventName.JOB_DEAD_LETTERED, handleLifecycle);
    };
  }, [socket, handleProgress, handleLifecycle]);

  return {
    progress: currentProgress,
    progressMessage: currentMessage,
    status: currentStatus,
    lastEvent,
    isConnected,
  };
}
