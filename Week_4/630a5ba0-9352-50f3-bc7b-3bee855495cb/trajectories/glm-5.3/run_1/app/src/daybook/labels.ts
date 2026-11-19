import { dayLabel } from '../../src-shared/domain';

const localZone = (timeZone: string): string => timeZone;

export const dayLabelOf = (date: string, timeZone: string): string => dayLabel(date, localZone(timeZone));
