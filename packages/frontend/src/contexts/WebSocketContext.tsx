"use client";
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";

type SocketStatus = "connecting" | "connected" | "disconnected";

interface WebSocketContextValue {
  status: SocketStatus;
  send: (data: string) => void;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  status: "disconnected",
  send: () => {},
});

export function WebSocketProvider({ url, children }: { url: string; children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryDelay = useRef(1000);
  const [status, setStatus] = useState<SocketStatus>("disconnected");

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelay.current = 1000;
        setStatus("connected");
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus("disconnected");
        const delay = Math.min(retryDelay.current, 30000);
        retryDelay.current = delay * 2;
        setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [url]);

  const send = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(data);
  };

  return (
    <WebSocketContext.Provider value={{ status, send }}>
      {status === "disconnected" && (
        <div style={{ background: "#f59e0b", color: "#fff", padding: "4px 12px", fontSize: 12 }}>
          Reconnecting...
        </div>
      )}
      {children}
    </WebSocketContext.Provider>
  );
}

export const useSocket = () => useContext(WebSocketContext);
