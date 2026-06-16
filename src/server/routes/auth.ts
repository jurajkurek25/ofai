import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createUser, findByEmail, findById } from '../../services/userService';
import { verifyPassword, generateToken } from '../../services/auth';
import { jwtAuth } from '../../middleware/jwtAuth';

interface RegisterBody {
  email: string;
  password: string;
  name: string;
}

interface LoginBody {
  email: string;
  password: string;
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
}
