/** A sparse gradient vector: `grads[i]` sits at column `cols[i]`. */
export type Gradient = { cols: number[]; grads: number[] };

/** One linearised constraint equation: `grad · dx = -residual`. */
export type Equation = Gradient & { residual: number };

export type Decomposition = {
  /** Number of independent equations. */
  rank: number;
  /** Row-space orthonormal basis, `rank` vectors of length `n`, packed row-major. */
  basis: Float64Array;
  /** Minimum-norm solution of the independent subsystem. */
  step: Float64Array;
  /** Per-equation independence, in input order. */
  independent: boolean[];
};

const DEPENDENT_RELATIVE_TOLERANCE = 1e-7;

/**
 * Orthogonalises the equations in order, carrying their targets, so that one pass yields
 * the rank, the row-space basis and the minimum-norm Gauss-Newton step.
 */
export function decompose(equations: Equation[], n: number): Decomposition {
  const maxRank = Math.min(equations.length, n);
  const basis = new Float64Array(maxRank * n);
  const targets = new Float64Array(maxRank);
  const work = new Float64Array(n);
  const independent: boolean[] = [];
  let rank = 0;

  for (const equation of equations) {
    work.fill(0);
    for (let i = 0; i < equation.cols.length; i += 1) {
      const col = equation.cols[i] as number;
      work[col] = (work[col] as number) + (equation.grads[i] as number);
    }
    let rowNormSquared = 0;
    for (let i = 0; i < equation.cols.length; i += 1) {
      const col = equation.cols[i] as number;
      rowNormSquared += (work[col] as number) * (work[col] as number);
    }
    const rowNorm = Math.sqrt(rowNormSquared);
    let target = -equation.residual;

    for (let k = 0; k < rank; k += 1) {
      const offset = k * n;
      let projection = 0;
      for (let i = 0; i < n; i += 1) {
        projection += (basis[offset + i] as number) * (work[i] as number);
      }
      if (projection === 0) continue;
      for (let i = 0; i < n; i += 1) {
        work[i] = (work[i] as number) - projection * (basis[offset + i] as number);
      }
      target -= projection * (targets[k] as number);
    }

    let remainingSquared = 0;
    for (let i = 0; i < n; i += 1) remainingSquared += (work[i] as number) * (work[i] as number);
    const remaining = Math.sqrt(remainingSquared);

    if (rowNorm > 0 && remaining > DEPENDENT_RELATIVE_TOLERANCE * rowNorm) {
      const offset = rank * n;
      for (let i = 0; i < n; i += 1) basis[offset + i] = (work[i] as number) / remaining;
      targets[rank] = target / remaining;
      rank += 1;
      independent.push(true);
    } else {
      independent.push(false);
    }
  }

  const step = new Float64Array(n);
  for (let k = 0; k < rank; k += 1) {
    const offset = k * n;
    const scale = targets[k] as number;
    if (scale === 0) continue;
    for (let i = 0; i < n; i += 1) {
      step[i] = (step[i] as number) + scale * (basis[offset + i] as number);
    }
  }

  return { rank, basis: basis.subarray(0, rank * n), step, independent };
}

function dot(a: Gradient, b: Gradient): number {
  let value = 0;
  for (let i = 0; i < a.cols.length; i += 1) {
    for (let j = 0; j < b.cols.length; j += 1) {
      if (a.cols[i] === b.cols[j]) value += (a.grads[i] as number) * (b.grads[j] as number);
    }
  }
  return value;
}

function basisDot(basis: Float64Array, offset: number, g: Gradient): number {
  let value = 0;
  for (let i = 0; i < g.cols.length; i += 1) {
    value += (basis[offset + (g.cols[i] as number)] as number) * (g.grads[i] as number);
  }
  return value;
}

/**
 * Remaining freedom of a point whose coordinates have gradients `gx` and `gy`:
 * the rank of the 2x2 Gram matrix of those gradients projected onto the null space.
 */
export function pointFreedom(
  basis: Float64Array,
  rank: number,
  n: number,
  gx: Gradient,
  gy: Gradient,
): 0 | 1 | 2 {
  let a = dot(gx, gx);
  let b = dot(gx, gy);
  let c = dot(gy, gy);
  const scale = Math.max(a, c);
  for (let k = 0; k < rank; k += 1) {
    const offset = k * n;
    const qx = basisDot(basis, offset, gx);
    const qy = basisDot(basis, offset, gy);
    a -= qx * qx;
    b -= qx * qy;
    c -= qy * qy;
  }
  const tolerance = Math.max(scale, 1) * 1e-9;
  const trace = a + c;
  const determinant = a * c - b * b;
  if (trace <= tolerance) return 0;
  const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * determinant));
  return (trace - discriminant) / 2 > tolerance ? 2 : 1;
}
