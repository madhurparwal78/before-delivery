import type { Response } from 'express';

export interface LiveEvent {
  type: 'stay' | 'room' | 'close' | 'checkin' | 'merge' | 'report';
  notice: string | null;
  stayId?: string;
  roomId?: string;
  businessDate?: string;
  number?: string;
  status?: string;
  arrival?: string | null;
  departure?: string | null;
}

export interface HousekeeperEvent {
  type: 'room';
  roomId: string;
  number: string;
  status: string;
  arrival: string | null;
  departure: string | null;
  notice: string | null;
}

type Client = { hotelId: string; role: string; res: Response; write: (event: string, data: string) => void };

const clients = new Set<Client>();

export function addClient(hotelId: string, role: string, res: Response): Client {
  const client: Client = {
    hotelId, role, res,
    write: (event, data) => {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    }
  };
  clients.add(client);
  return client;
}

export function removeClient(client: Client): void {
  clients.delete(client);
}

export function publish(hotelId: string, event: LiveEvent | HousekeeperEvent): void {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.hotelId !== hotelId) continue;
    if (client.role === 'housekeeper') {
      if (event.type === 'room') {
        const e = event as HousekeeperEvent;
        client.write('change', JSON.stringify({
          type: 'room', roomId: e.roomId, number: e.number, status: e.status,
          arrival: e.arrival, departure: e.departure, notice: e.notice ?? null
        }));
      }
    } else {
      client.write('change', data);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
