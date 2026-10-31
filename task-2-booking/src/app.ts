// @rev kc-31
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { BookingService, Result } from './booking.ts';
import type { Master, Service } from './types.ts';

export function createApp(booking: BookingService, masters: Master[], services: Service[]): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (req.method === 'GET' && url.pathname === '/masters') {
        return send(res, 200, masters);
      }

      if (req.method === 'GET' && url.pathname === '/services') {
        return send(res, 200, services);
      }

      if (req.method === 'GET' && parts[0] === 'masters' && parts[2] === 'slots' && parts.length === 3) {
        const q = url.searchParams;
        return reply(res, 200, await booking.slots(parts[1], q.get('serviceId'), q.get('date')));
      }

      if (req.method === 'POST' && url.pathname === '/bookings') {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch {
          return send(res, 400, { error: 'invalid_json' });
        }
        return reply(res, 201, await booking.create(body));
      }

      if (req.method === 'DELETE' && parts[0] === 'bookings' && parts.length === 2) {
        return reply(res, 200, await booking.cancel(parts[1]));
      }

      send(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error(err);
      send(res, 500, { error: 'internal' });
    }
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

function reply<T>(res: ServerResponse, okStatus: number, result: Result<T>) {
  if (result.ok) return send(res, okStatus, result.value);
  send(res, result.status, { error: result.error });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
