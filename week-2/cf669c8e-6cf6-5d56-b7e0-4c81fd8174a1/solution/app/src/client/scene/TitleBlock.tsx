import type { ReactNode } from 'react';

/** The ruled title block under the scene: donor, kit and road class. */
export function TitleBlock({ donor, kit, roadClass }: { donor: ReactNode; kit: ReactNode; roadClass: ReactNode }): ReactNode {
  return (
    <dl className="title-block">
      <div className="title-cell"><dt>Donor</dt><dd>{donor}</dd></div>
      <div className="title-cell"><dt>Kit</dt><dd>{kit}</dd></div>
      <div className="title-cell"><dt>Road class</dt><dd>{roadClass}</dd></div>
    </dl>
  );
}
