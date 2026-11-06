import type { RouteConfig } from '@react-router/dev/routes';

export default [
  { path: '/', file: 'routes/home.jsx' },
  { path: '/login', file: 'routes/login.jsx' },
  {
    path: '/requests',
    file: 'routes/requests.layout.jsx',
    children: [
      { index: true, file: 'routes/requests.index.jsx' },
      { path: 'new', file: 'routes/requests.new.jsx' },
      { path: ':id', file: 'routes/requests.$id.jsx' },
    ],
  },
  { path: '/calendar', file: 'routes/calendar.jsx' },
  { path: '/policy', file: 'routes/policy.jsx' },
  { path: '/share/:token', file: 'routes/share.$token.jsx' },
  { path: '*', file: 'routes/splat.jsx' },
] satisfies RouteConfig;
