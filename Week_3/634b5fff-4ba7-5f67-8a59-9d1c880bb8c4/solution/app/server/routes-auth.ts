import type { FastifyInstance } from "fastify";
import { finishLogin, logout, startLogin } from "./auth.js";

export const registerAuthRoutes = (app: FastifyInstance): void => {
  app.get("/auth/login", startLogin);
  app.get("/auth/callback", finishLogin);
  app.post("/auth/logout", logout);
};
