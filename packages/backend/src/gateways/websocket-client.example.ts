/**
 * websocket-client.example.ts
 *
 * Shows how a frontend (React / plain TS) connects to the gateway
 * and subscribes to market rooms and user notifications.
 *
 * Install: npm install socket.io-client
 */

import { io, Socket } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:3000';

// ─── Connect ───────────────────────────────────────────────────────────────

const socket: Socket = io(`${BACKEND_URL}/ws`, {
  transports: ['websocket'],
  autoConnect: true,
});

socket.on('connect', () => {
  console.log('🟢 Connected to WebSocket gateway, socket id:', socket.id);
});

socket.on('connect_error', (err) => {
  console.error('🔴 Connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.warn('🟡 Disconnected:', reason);
});

// ─── Subscribe to a Market ─────────────────────────────────────────────────

export function subscribeToMarket(marketId: string) {
  socket.emit('market:subscribe', { marketId });

  socket.on('market:subscribed', ({ marketId }) => {
    console.log(`✅ Subscribed to market ${marketId}`);
  });

  // Live stake events for this market
  socket.on('stake:created', (stake) => {
    console.log('📌 New stake on market:', stake);
    // update your UI state here
  });

  // Live price updates for this market
  socket.on('market:priceUpdated', (update) => {
    console.log('💲 Prices updated:', update);
    // update your odds display here
  });
}

export function unsubscribeFromMarket(marketId: string) {
  socket.emit('market:unsubscribe', { marketId });
}

// ─── Subscribe to Private User Notifications ───────────────────────────────

export function subscribeToUserNotifications(jwtToken: string) {
  socket.emit('user:subscribe', { token: jwtToken });

  socket.on('user:subscribed', ({ userId }) => {
    console.log(`🔔 Listening for notifications for user ${userId}`);
  });

  socket.on('notification', (notification) => {
    console.log('🔔 Incoming notification:', notification);
    // show toast / badge in your UI
  });

  socket.on('error', ({ message }) => {
    console.error('WebSocket error:', message);
  });
}

export function unsubscribeFromUserNotifications() {
  socket.emit('user:unsubscribe');
}