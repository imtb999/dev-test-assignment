import { createServer, type Server, type ServerResponse } from 'node:http';
import { isValidDate, type Dispatch } from './dispatch.ts';
import type { Branch } from './types.ts';

export function createApp(dispatch: Dispatch, branches: Branch[]): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (req.method === 'GET' && url.pathname === '/branches') {
        return send(res, 200, branches);
      }

      if (req.method === 'GET' && parts[0] === 'orders' && parts.length === 2) {
        const order = dispatch.findOrder(parts[1]);
        if (!order) return send(res, 404, { error: 'order_not_found' });
        return send(res, 200, order);
      }

      if (req.method === 'POST' && parts[0] === 'orders' && parts[2] === 'assign' && parts.length === 3) {
        const order = dispatch.findOrder(parts[1]);
        if (!order) return send(res, 404, { error: 'order_not_found' });
        return send(res, 200, dispatch.assign(order));
      }

      if (req.method === 'GET' && parts[0] === 'branches' && parts[2] === 'load' && parts.length === 3) {
        const date = url.searchParams.get('date');
        if (!date || !isValidDate(date)) return send(res, 400, { error: 'invalid_date' });
        const branch = dispatch.findBranch(parts[1]);
        if (!branch) return send(res, 404, { error: 'branch_not_found' });
        return send(res, 200, dispatch.branchLoad(branch, date));
      }

      send(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error(err);
      send(res, 500, { error: 'internal' });
    }
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
