import { useEffect, useState } from "react";
import type { ShelfLibrary } from "../../shared/types.js";
import { Shell } from "../components/shell.js";
import { loadShelf } from "../config.js";

export function ShelfPage(): React.JSX.Element {
  const [libraries, setLibraries] = useState<ShelfLibrary[]>([]);
  useEffect(() => {
    void loadShelf().then(setLibraries);
  }, []);
  return (
    <Shell>
      <section className="wide-page">
        <h1>The shelf</h1>
        <p className="lede-small">Pens load libraries only from these pinned files, which Ashlar serves itself.</p>
        <div className="shelf-scroll" role="region" aria-label="Pinned libraries table" tabIndex={0}>
        <table aria-label="Pinned libraries" className="shelf">
          <thead>
            <tr>
              <th scope="col">Library</th>
              <th scope="col">Version</th>
              <th scope="col">Global</th>
              <th scope="col">Licence</th>
              <th scope="col">Size (bytes)</th>
            </tr>
          </thead>
          <tbody>
            {libraries.map((library) => (
              <tr key={library.id}>
                <th scope="row">{library.name}</th>
                <td className="tabular">{library.version}</td>
                <td className="mono-cell">{library.global}</td>
                <td>{library.license}</td>
                <td className="tabular">{library.bytes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </Shell>
  );
}
