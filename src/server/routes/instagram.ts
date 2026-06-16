import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtAuth } from '../../middleware/jwtAuth';
import { db } from '../../db/database';

interface IGConnection {
  id: number;
  user_id: number;
  ig_account_id: string;
  ig_username: string | null;
  access_token: string;
  persona_id: number | null;
  connected_at: number;
}

interface ConnectBody {
  ig_account_id: string;
  ig_username?: string;
  access_token: string;
  persona_id?: number;
}

export async function instagramRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: jwtAuth };

  // POST /api/instagram/connect
  fastify.post<{ Body: ConnectBody }>(
    '/api/instagram/connect',
    auth,
    async (request: FastifyRequest<{ Body: ConnectBody }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { ig_account_id, ig_username, access_token, persona_id } = request.body;

      if (!ig_account_id || !access_token) {
        return reply.code(400).send({ error: 'ig_account_id and access_token are required' });
      }

      db.prepare(
        `INSERT INTO instagram_connections (user_id, ig_account_id, ig_username, access_token, persona_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           ig_account_id = excluded.ig_account_id,
           ig_username = excluded.ig_username,
           access_token = excluded.access_token,
           persona_id = excluded.persona_id,
           connected_at = unixepoch()`
      ).run(userId, ig_account_id, ig_username ?? null, access_token, persona_id ?? null);

      const connection = db
        .prepare('SELECT * FROM instagram_connections WHERE user_id = ?')
        .get(userId) as IGConnection;

      return reply.send({
        connection: {
          id: connection.id,
          ig_account_id: connection.ig_account_id,
          ig_username: connection.ig_username,
          persona_id: connection.persona_id,
          connected_at: connection.connected_at,
        },
      });
    }
  );

  // GET /api/instagram/status
  fastify.get(
    '/api/instagram/status',
    auth,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const connection = db
        .prepare('SELECT * FROM instagram_connections WHERE user_id = ?')
        .get(userId) as IGConnection | undefined;

      if (!connection) {
        return reply.send({ connected: false });
      }

      return reply.send({
        connected: true,
        connection: {
          id: connection.id,
          ig_account_id: connection.ig_account_id,
          ig_username: connection.ig_username,
          persona_id: connection.persona_id,
          connected_at: connection.connected_at,
        },
      });
    }
  );

  // DELETE /api/instagram/disconnect
  fastify.delete(
    '/api/instagram/disconnect',
    auth,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.userId;
      db.prepare('DELETE FROM instagram_connections WHERE user_id = ?').run(userId);
      return reply.send({ success: true });
    }
  );
}
