import type { Preview } from '../api';
import { signedTonnes } from '../format';
import { Dialog } from './Dialog';

export interface UnitBreakdownDialogProps {
  readonly preview: Preview;
  readonly onClose: () => void;
}

const FACTORS = [
  'Half-hour integration: 1800 s per reading',
  'CO2: 0.00004401 g per µmol',
  'CH4: 0.00000001604 g per nmol, GWP100 27.0',
  'Grams to tonnes: divide by 1,000,000',
];

export function UnitBreakdownDialog(props: UnitBreakdownDialogProps): React.ReactElement {
  const { preview } = props;
  const totalArea = preview.contributions.reduce(
    (sum, contribution) => sum + contribution.area_m2,
    0,
  );
  const halfHours = preview.contributions[0]?.half_hours ?? 0;
  return (
    <Dialog label="Unit breakdown" onClose={props.onClose} initialFocus="first">
      <h2>Unit breakdown</h2>
      <ul>
        {FACTORS.map((factor) => (
          <li key={factor} className="num" style={{ fontSize: '0.8125rem' }}>
            {factor}
          </li>
        ))}
      </ul>
      <table aria-label="Unit breakdown">
        <thead>
          <tr>
            <th scope="col">Sensor</th>
            <th scope="col">Kind</th>
            <th scope="col">Area m²</th>
            <th scope="col">Qualifying half-hours</th>
            <th scope="col">CO2 tCO2e</th>
            <th scope="col">CH4 tCO2e</th>
            <th scope="col">Net tCO2e</th>
          </tr>
        </thead>
        <tbody>
          {preview.contributions.map((contribution) => (
            <tr key={contribution.sensor_id}>
              <td className="num">{contribution.sensor_id}</td>
              <td>{contribution.kind === 'tower' ? 'Tower' : 'Satellite cell'}</td>
              <td className="num">{contribution.area_m2}</td>
              <td className="num">{contribution.qualifying_half_hours}</td>
              <td className="num">{signedTonnes(contribution.co2_tco2e)}</td>
              <td className="num">{signedTonnes(contribution.ch4_tco2e)}</td>
              <td className="num">{signedTonnes(contribution.net_tco2e)}</td>
            </tr>
          ))}
          <tr>
            <td>Total</td>
            <td />
            <td className="num">{totalArea}</td>
            <td className="num">{halfHours}</td>
            <td className="num">{signedTonnes(preview.co2_tco2e)}</td>
            <td className="num">{signedTonnes(preview.ch4_tco2e)}</td>
            <td className="num">{signedTonnes(preview.net_tco2e)}</td>
          </tr>
        </tbody>
      </table>
      <div className="dialog-actions">
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
