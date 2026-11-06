/**
 * Every API endpoint, in brief order.
 */
import { auth_routes } from './routes_auth.js'
import { catalogue_routes } from './routes_catalogue.js'
import { cart_routes } from './routes_cart.js'
import { checkout_routes } from './routes_checkout.js'
import { project_routes } from './routes_projects.js'
import { admin_routes } from './routes_admin.js'
import { misc_routes } from './routes_misc.js'
import type { Api } from './api.js'

export function register_routes(api: Api): void {
  auth_routes(api)
  catalogue_routes(api)
  cart_routes(api)
  checkout_routes(api)
  project_routes(api)
  admin_routes(api)
  misc_routes(api)
}
