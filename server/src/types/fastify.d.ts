import 'fastify';

export interface AuthIdentity {
  clerkUserId: string;
  tokenSub: string;
  authMode: 'clerk' | 'dev';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthIdentity;
    appUserId: string;
    deviceId: string;
  }
}
