import { empty } from '../../domain/copy.ts';
import { navigate } from '../router.ts';

export function NotFound(props: { kind: 'document' | 'page' }) {
  return (
    <div className="screen">
      <h1 className="display">{props.kind === 'document' ? empty.documentNotFound : empty.pageNotFound}</h1>
      <a
        href="/"
        onClick={(event) => {
          event.preventDefault();
          navigate('/');
        }}
      >
        {empty.backToDocuments}
      </a>
    </div>
  );
}
