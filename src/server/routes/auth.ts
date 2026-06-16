import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createUser, findByEmail, findById, findByInstagramOAuthId, createOAuthUser } from '../../services/userService';
import { verifyPassword, generateToken } from '../../services/auth';
import { jwtAuth } from '../../middleware/jwtAuth';
import { config } from '../../config/config';
import axios from 'axios';
import crypto from 'crypto';

interface RegisterBody {
  email: string;
  password: string;
  name: string;
}

interface LoginBody {
  email: string;
  password: string;
}

const oauthStates = new Map<string, number>();

function getAppOrigin(request: FastifyRequest): string {
  const proto = (request.headers['x-forwarded-proto'] as string) || 'http';
  const host = (request.headers['x-forwarded-host'] as string) || request.hostname;
  return `${proto}://${host}`;
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: RegisterBody }>(
    '/api/auth/register',
    async (request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
      const { email, password, name } = request.body;

      if (!email || !password || !name) {
        return reply.code(400).send({ error: 'email, password, and name are required' });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.code(400).send({ error: 'Invalid email format' });
      }

      if (password.length < 8) {
        return reply.code(400).send({ error: 'Password must be at least 8 characters' });
      }

      try {
        const user = await createUser(email.toLowerCase().trim(), password, name.trim());
        const token = generateToken(user.id, user.email);
        return reply.code(201).send({
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            plan: user.plan,
            created_at: user.created_at,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Registration failed';
        if (message.includes('already registered')) {
          return reply.code(409).send({ error: message });
        }
        return reply.code(500).send({ error: message });
      }
    }
  );

  fastify.post<{ Body: LoginBody }>(
    '/api/auth/login',
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { email, password } = request.body;

      if (!email || !password) {
        return reply.code(400).send({ error: 'email and password are required' });
      }

      const user = findByEmail(email.toLowerCase().trim());
      if (!user) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      if (!user.is_active) {
        return reply.code(403).send({ error: 'Account is disabled' });
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const token = generateToken(user.id, user.email);
      return reply.send({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          plan: user.plan,
          plan_expires_at: user.plan_expires_at,
          created_at: user.created_at,
        },
      });
    }
  );

  fastify.get(
    '/api/auth/me',
    { preHandler: jwtAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = findById(request.user!.userId);
      if (!user) return reply.code(404).send({ error: 'User not found' });

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        plan_expires_at: user.plan_expires_at,
        stripe_customer_id: user.stripe_customer_id,
        created_at: user.created_at,
      });
    }
  );

  // GET /api/auth/instagram — start Facebook Login OAuth (works with Business apps)
  fastify.get('/api/auth/instagram', async (request: FastifyRequest, reply: FastifyReply) => {
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now() + 10 * 60 * 1000);

    const origin = getAppOrigin(request);
    const redirectUri = `${origin}/api/auth/instagram/callback`;

    const params = new URLSearchParams({
      client_id: config.meta.appId,
      redirect_uri: redirectUri,
      scope: 'instagram_basic',
      response_type: 'code',
      state,
    });

    return reply.redirect(`https://www.facebook.com/dialog/oauth?${params.toString()}`);
  });

  // GET /api/auth/instagram/callback — handle Facebook Login callback
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/instagram/callback',
    async (request: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>, reply: FastifyReply) => {
      const { code, state, error } = request.query;
      const origin = getAppOrigin(request);

      if (error || !code || !state) {
        return reply.redirect(`${origin}/#ig-login-error=${encodeURIComponent(error || 'cancelled')}`);
      }

      const storedExpiry = oauthStates.get(state);
      if (!storedExpiry || Date.now() > storedExpiry) {
        return reply.redirect(`${origin}/#ig-login-error=invalid_state`);
      }
      oauthStates.delete(state);

      try {
        const redirectUri = `${origin}/api/auth/instagram/callback`;

        // Exchange code for access token
        const tokenRes = await axios.get('https://graph.facebook.com/v20.0/oauth/access_token', {
          params: {
            client_id: config.meta.appId,
            client_secret: config.meta.appSecret,
            redirect_uri: redirectUri,
            code,
          },
        });
        const accessToken = (tokenRes.data as { access_token: string }).access_token;

        // Get Instagram accounts linked to this token
        const pagesRes = await axios.get('https://graph.facebook.com/v20.0/me/accounts', {
          params: { access_token: accessToken, fields: 'instagram_business_account,name' },
        });
        const pages = (pagesRes.data as { data: Array<{ name: string; instagram_business_account?: { id: string } }> }).data;

        let igId: string | null = null;
        let displayName = 'Instagram User';
        for (const page of pages) {
          if (page.instagram_business_account?.id) {
            igId = page.instagram_business_account.id;
            displayName = page.name;
            break;
          }
        }

        // Fallback: use FB user id if no IG account found
        if (!igId) {
          const meRes = await axios.get('https://graph.facebook.com/v20.0/me', {
            params: { fields: 'id,name', access_token: accessToken },
          });
          const me = meRes.data as { id: string; name: string };
          igId = `fb_${me.id}`;
          displayName = me.name || displayName;
        }

        let user = findByInstagramOAuthId(igId);
        if (!user) {
          user = await createOAuthUser(igId, displayName);
        }

        const token = generateToken(user.id, user.email);
        const userJson = encodeURIComponent(JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name,
          plan: user.plan,
          plan_expires_at: user.plan_expires_at,
          created_at: user.created_at,
        }));

        return reply.redirect(`${origin}/#ig-login=${token}&ig-user=${userJson}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'OAuth failed';
        return reply.redirect(`${origin}/#ig-login-error=${encodeURIComponent(msg)}`);
      }
    }
  );
}
