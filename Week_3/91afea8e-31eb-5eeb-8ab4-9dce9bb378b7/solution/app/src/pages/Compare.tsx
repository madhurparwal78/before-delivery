import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { rupees } from "../../shared/format";
import { Button } from "../components/Button";
import { Empty } from "../components/Empty";
import { NotFound } from "../components/NotFound";
import { ProductArt } from "../components/ProductArt";
import { ApiFailure, get } from "../lib/api";
import { useTitle } from "../lib/hooks";
import "../styles/catalogue.css";

interface Compared {
  category: string;
  products: { id: string; title: string; brand: string; rating: number; image_url: string; best_price_paise: number | null }[];
  attributes: { name: string; values: (string | number | null)[]; differs: boolean }[];
}

interface Row {
  name: string;
  cells: string[];
  differs: boolean;
}

const words = (name: string): string => {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

function rowsOf(found: Compared): Row[] {
  const fixed: { name: string; cells: string[] }[] = [
    { name: "Brand", cells: found.products.map((product) => product.brand) },
    { name: "Rating", cells: found.products.map((product) => product.rating.toFixed(1)) },
    { name: "Best price", cells: found.products.map((product) => (product.best_price_paise === null ? "not on sale" : rupees(product.best_price_paise))) },
  ];
  const specs = found.attributes.map((attribute) => ({ name: words(attribute.name), cells: attribute.values.map((value) => (value === null ? "not listed" : String(value))) }));
  return [...fixed, ...specs].map((row) => ({ ...row, differs: new Set(row.cells).size > 1 }));
}

export default function Compare(): ReactNode {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ids = [...new Set((params.get("ids") ?? "").split(",").filter((id) => id !== ""))];
  const diff = params.get("diff") === "1";
  const key = ids.join(",");
  const [found, setFound] = useState<Compared | null>(null);
  const [problem, setProblem] = useState("");
  const [missing, setMissing] = useState(false);

  useTitle("compare");

  useEffect(() => {
    setFound(null);
    setProblem("");
    setMissing(false);
    if (key.split(",").filter((id) => id !== "").length < 2) return undefined;
    let live = true;
    get<Compared>(`/api/compare?ids=${key}`).then(
      (result) => live && setFound(result),
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        if (!live) return;
        if (error.status === 404) setMissing(true);
        else setProblem(error.body.errors?.ids ?? error.body.message);
      },
    );
    return () => {
      live = false;
    };
  }, [key]);

  const address = (next: string[], highlight: boolean): string => `/compare?ids=${next.join(",")}&diff=${highlight ? 1 : 0}`;

  if (missing) return <NotFound />;
  const rows = found ? rowsOf(found) : [];

  return (
    <div className="compare-page">
      <section className="panel panel--ground">
        <h1>compare</h1>
        {ids.length < 2 && (
          <Empty tone="pink" sign="box">
            Pick at least 2 products.
          </Empty>
        )}
        {problem !== "" && (
          <Empty tone="black" sign="lost">
            {problem}
          </Empty>
        )}
        {ids.length >= 2 && found && (
          <button type="button" role="switch" aria-checked={diff} className={`btn switch${diff ? " switch--on" : ""}`} onClick={() => navigate(address(ids, !diff), { replace: true })}>
            <span className="switch__track" aria-hidden="true" />
            Highlight differences
            <span aria-hidden="true">{diff ? "on" : "off"}</span>
          </button>
        )}
      </section>
      {ids.length >= 2 && (
        <section className="panel panel--raised">
          {found ? (
            <div className="table-scroll">
              <table className="compare" aria-label="Compare products">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Attribute</span>
                    </th>
                    {found.products.map((product) => (
                      <th key={product.id} scope="col">
                        <div className="compare__product">
                          <ProductArt src={product.image_url} alt="" category={found.category} />
                          <Link to={`/p/${product.id}`}>{product.title}</Link>
                          <Button small onClick={() => navigate(address(ids.filter((id) => id !== product.id), diff))}>
                            <X size={18} aria-hidden="true" />
                            {`Remove ${product.title}`}
                          </Button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name} className={diff && row.differs ? "compare__differs" : undefined} data-differs={diff && row.differs ? "true" : undefined}>
                      <th scope="row">
                        {row.name}
                        {diff && row.differs && <span className="chip chip--yellow">differs</span>}
                      </th>
                      {row.cells.map((cell, index) => (
                        <td key={(found.products[index] as Compared["products"][number]).id}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            problem === "" && <div className="skeleton" aria-busy="true" />
          )}
        </section>
      )}
    </div>
  );
}
