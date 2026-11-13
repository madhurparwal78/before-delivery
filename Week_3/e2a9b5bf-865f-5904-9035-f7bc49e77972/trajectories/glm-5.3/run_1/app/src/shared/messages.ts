// One table of every validation message the API and the browser share.
export const fieldMessages = {
  email: "Enter an email address.",
  password: "Use at least 10 characters.",
  display_name: "Enter your name as it should appear on packets.",
  name: "Give it a name of up to 60 characters.",
  aperture: "Aperture must be from 25 mm to 1,600 mm.",
  focal_length_mm: "Focal length must be from 100 mm to 20,000 mm.",
  eyepiece_focal_length_mm: "Eyepiece focal length must be from 2 mm to 60 mm.",
  apparent_field_deg: "Apparent field must be from 30° to 120°.",
  factor: "Barlow factor must be from 1.1× to 5.0×.",
  latitude: "Latitude must be from -90 to 90.",
  longitude: "Longitude must be from -180 to 180.",
  time_zone: "Choose a time zone from the list.",
  observed_at: "Use a UT time during this session.",
  seeing: "Seeing is a whole number from 1 to 10.",
  transparency_nelm: "Transparency is a limiting magnitude from 1.0 to 8.0.",
  description: "Keep the description to 4,000 characters or fewer.",
  concentration_class: "Concentration class is I to XII, for globular clusters only.",
  pair: "A measured pair is two different points, for double stars only.",
  optics: "Choose a telescope and an eyepiece from your kit.",
  train: "Choose a train from the list.",
  strokes: "The sketch file is not a Lowlamp stroke file.",
  raster: "The sketch image must be a PNG of 2,000,000 bytes or fewer.",
  started_at: "A session can't start in the future.",
  object_id: "Choose an object from the catalogue.",
  edited_at: "The edit time is in the future.",
  revision: "Send the revision you are acting on.",
  device: "Give a device name of up to 40 characters.",
} as const;

export type FieldName = keyof typeof fieldMessages;

export const genericSentences = {
  notFound: "We couldn't find that here.",
  serverError: "Something went wrong on our side. Nothing was lost; try again.",
  needsSignal: "That needs signal. Nothing was changed.",
} as const;
