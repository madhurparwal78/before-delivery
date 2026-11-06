import { route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.jsx"),
  route("requests", "routes/queue.jsx"),
  route("requests/new", "routes/raise.jsx"),
  route("requests/:id", "routes/detail.jsx"),
  route("calendar", "routes/calendar.jsx"),
  route("policy", "routes/policy.jsx"),
  route("share/:token", "routes/shared.jsx"),
  route("*", "routes/missing.jsx"),
];
