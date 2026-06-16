import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtAuth } from '../../middleware/jwtAuth';
import { db } from '../../db/database';
import { config } from '../../config/config';
import { generateToken } from '../../services/auth';
import axios from 'axios';
import crypto from 'crypto';

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

const igOAuthStates = new Map<string, { userId: number; expiry: number }>();

function getOrigin(request: FastifyRequest): string {
  const proto = (request.headers['x-forwarded-proto'] as string) || 'http';
  const host = (request.headers['x-forwarded-host'] as string) || request.hostname;
  return `${proto}://${host}`;
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

  // PATCH /api/instagram/persona — update persona assignment only
  fastify.patch<{ Body: { persona_id?: number | null } }>(
    '/api/instagram/persona',
    auth,
    async (request: FastifyRequest<{ Body: { persona_id?: number | null } }>, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { persona_id } = request.body;
      db.prepare('UPDATE instagram_connections SET persona_id = ? WHERE user_id = ?')
        .run(persona_id ?? null, userId);
      return reply.send({ success: true });
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

  // GET /api/instagram/oauth/start — start Facebook/IG Business OAuth
  fastify.get<{ Querystring: { token?: string } }>(
    '/api/instagram/oauth/start',
    async (request: FastifyRequest<{ Querystring: { token?: string } }>, reply: FastifyReply) => {
      // Accept token from query param (browser redirect can't send Authorization header)
      const { verifyToken } = await import('../../services/auth');
      const raw = request.query.token ?? (request.headers['authorization'] as string ?? '').replace('Bearer ', '');
      const payload = raw ? verifyToken(raw) : null;
      if (!payload) return reply.code(401).send({ error: 'Unauthorized' });
      const userId = payload.userId;
      const state = crypto.randomBytes(16).toString('hex');
      igOAuthStates.set(state, { userId, expiry: Date.now() + 10 * 60 * 1000 });

      const origin = getOrigin(request);
      const redirectUri = `${origin}/api/instagram/oauth/callback`;

      const params = new URLSearchParams({
        client_id: config.meta.appId,
        redirect_uri: redirectUri,
        scope: 'instagram_basic,instagram_manage_messages,pages_show_list,pages_manage_metadata',
        response_type: 'code',
        state,
      });

      return reply.redirect(`https://www.facebook.com/dialog/oauth?${params.toString()}`);
    }
  );

  // GET /api/instagram/oauth/callback — exchange code, get IG account, save connection
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/instagram/oauth/callback',
    async (request: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>, reply: FastifyReply) => {
      const { code, state, error } = request.query;
      const origin = getOrigin(request);

      if (error || !code || !state) {
        return reply.redirect(`${origin}/#ig-connect-error=${encodeURIComponent(error || 'cancelled')}`);
      }

      const stored = igOAuthStates.get(state);
      if (!stored || Date.now() > stored.expiry) {
        return reply.redirect(`${origin}/#ig-connect-error=invalid_state`);
      }
      igOAuthStates.delete(state);
      const userId = stored.userId;

      try {
        const redirectUri = `${origin}/api/instagram/oauth/callback`;

        // Exchange code for user access token
        const tokenRes = await axios.get('https://graph.facebook.com/v20.0/oauth/access_token', {
          params: {
            client_id: config.meta.appId,
            client_secret: config.meta.appSecret,
            redirect_uri: redirectUri,
            code,
          },
        });
        const userAccessToken = (tokenRes.data as { access_token: string }).access_token;

        // Get long-lived token
        const longTokenRes = await axios.get('https://graph.facebook.com/v20.0/oauth/access_token', {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: config.meta.appId,
            client_secret: config.meta.appSecret,
            fb_exchange_token: userAccessToken,
          },
        });
        const longLivedToken = (longTokenRes.data as { access_token: string }).access_token;

        // Get Facebook pages
        const pagesRes = await axios.get('https://graph.facebook.com/v20.0/me/accounts', {
          params: { access_token: longLivedToken, fields: 'id,name,access_token,instagram_business_account' },
        });
        const pages = (pagesRes.data as { data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }> }).data;

        // Find first page with an Instagram Business account
        let igAccountId: string | null = null;
        let igUsername: string | null = null;
        let finalToken: string = longLivedToken;

        for (const page of pages) {
          if (page.instagram_business_account?.id) {
            igAccountId = page.instagram_business_account.id;
            finalToken = page.access_token;

            // Get IG username
            try {
              const igRes = await axios.get(`https://graph.facebook.com/v20.0/${igAccountId}`, {
                params: { fields: 'username', access_token: finalToken },
              });
              igUsername = (igRes.data as { username?: string }).username ?? null;
            } catch (_) {}
            break;
          }
        }

        if (!igAccountId) {
          return reply.redirect(`${origin}/#ig-connect-error=no_instagram_account`);
        }

        // Save connection (persona_id null — user picks it in the UI)
        db.prepare(
          `INSERT INTO instagram_connections (user_id, ig_account_id, ig_username, access_token, persona_id)
           VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(user_id) DO UPDATE SET
             ig_account_id = excluded.ig_account_id,
             ig_username = excluded.ig_username,
             access_token = excluded.access_token,
             connected_at = unixepoch()`
        ).run(userId, igAccountId, igUsername, finalToken);

        return reply.redirect(`${origin}/#ig-connected=1`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'OAuth failed';
        return reply.redirect(`${origin}/#ig-connect-error=${encodeURIComponent(msg)}`);
      }
    }
  );
}
