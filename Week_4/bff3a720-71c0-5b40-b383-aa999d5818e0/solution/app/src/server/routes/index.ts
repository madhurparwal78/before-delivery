import type { Route } from "../http/pipeline";
import { accountRoutes } from "./accounts";
import { bookingRoutes } from "./bookings";
import { miscRoutes } from "./misc";
import { rideRoutes } from "./rides";

/** Order matters where a fixed path shares a prefix with a parameter (`/api/rides/search` before `/api/rides/:id`). */
export const routes: Route[] = [...accountRoutes, ...rideRoutes, ...bookingRoutes, ...miscRoutes];
