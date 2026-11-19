/**
 * SQL predicates for the two relations every read leaves out or lets through: blocks and visibility.
 * `viewer` is a parameter placeholder such as `$1`; `member` is a column expression holding a member id.
 */

/** True when no block exists between the viewer and the member, in either direction. */
export const notBlockedWith = (viewer: string, member: string): string =>
  `NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = ${viewer} AND bl.blocked_id = ${member})
                                          OR (bl.blocker_id = ${member} AND bl.blocked_id = ${viewer}))`;

/** True when the viewer and the member are connected (1st degree). */
export const connectedWith = (viewer: string, member: string): string =>
  `EXISTS (SELECT 1 FROM connections cn WHERE cn.member_lo = LEAST(${viewer}, ${member}) AND cn.member_hi = GREATEST(${viewer}, ${member}))`;

/**
 * True when the viewer may see the member and what they author: no block either way, and a private member
 * only to themselves and their 1st-degree connections. `alias` names a `members` row in the query.
 */
export const memberVisibleTo = (viewer: string, alias: string): string =>
  `(${notBlockedWith(viewer, `${alias}.id`)}
    AND (${alias}.visibility <> 'private' OR ${alias}.id = ${viewer} OR ${connectedWith(viewer, `${alias}.id`)}))`;
