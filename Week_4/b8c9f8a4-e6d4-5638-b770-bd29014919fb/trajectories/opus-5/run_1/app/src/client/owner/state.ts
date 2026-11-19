import type {
  AlertDto,
  CarDto,
  FindingDto,
  LinkDto,
  OwnerOfferDto,
  PanelsResponse,
  RecordDto,
  SlotDto,
  UploadDto,
} from '../../shared/types';
import { request } from '../shared/api';

export interface CarFileState {
  car: CarDto;
  panels: PanelsResponse;
  findings: FindingDto[];
  uploads: UploadDto[];
  record: RecordDto | null;
  links: LinkDto[];
  slots: SlotDto[];
  offers: OwnerOfferDto[];
  alerts: AlertDto[];
}

export const loadCarFile = async (carId: string): Promise<CarFileState> => {
  const base = `/api/owner/cars/${carId}`;
  // The car says whether there is a pull, so the record is only asked for when it exists.
  const car = await request<CarDto>(base);
  const [panels, findings, uploads, record, links, slots, offers, alerts] = await Promise.all([
    request<PanelsResponse>(`${base}/panels`),
    request<{ findings: FindingDto[] }>(`${base}/findings`),
    request<{ uploads: UploadDto[] }>(`${base}/uploads`),
    car.pulledAt === null ? Promise.resolve(null) : request<RecordDto>(`${base}/record`),
    request<{ links: LinkDto[] }>(`${base}/links`),
    request<{ slots: SlotDto[] }>(`${base}/slots`),
    request<{ offers: OwnerOfferDto[] }>(`${base}/offers`),
    request<{ alerts: AlertDto[] }>('/api/owner/alerts'),
  ]);

  return {
    car,
    panels,
    findings: findings.findings,
    uploads: uploads.uploads,
    record,
    links: links.links,
    slots: slots.slots,
    offers: offers.offers,
    alerts: alerts.alerts.filter((alert) => alert.carId === carId),
  };
};
