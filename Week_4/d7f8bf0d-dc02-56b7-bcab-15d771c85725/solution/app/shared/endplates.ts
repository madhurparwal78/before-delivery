import type { Endplate, StandardsProfile } from './domain'

export type EndplateType = 'single' | 'double'

// What the club standard says an endplate of this type is: its width and where the track sits.
export function standardEndplate(type: EndplateType, standards: StandardsProfile): Pick<Endplate, 'width_mm' | 'track_offsets_mm'> {
  return type === 'double'
    ? { width_mm: standards.endplate_double_mm, track_offsets_mm: [-standards.double_track_offset_mm, standards.double_track_offset_mm] }
    : { width_mm: standards.endplate_single_mm, track_offsets_mm: [0] }
}
