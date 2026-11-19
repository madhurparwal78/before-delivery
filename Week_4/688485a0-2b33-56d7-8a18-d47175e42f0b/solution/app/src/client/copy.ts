import { displayNumber } from "../shared/display.js";
import type { ErrorBody } from "../shared/messages.js";

/** The exact refusal copy of the Feedback states table. */

const FIELD_NAMES: Record<string, string> = { filter: "Filter", projection: "Projection", sort: "Sort" };

function guardText(body: ErrorBody): string {
  return `Query stopped: more than ${displayNumber(Number(body["limit"]))} documents would be scanned. Add an index or narrow the filter.`;
}

const deepText = (body: ErrorBody): string => `Query is nested deeper than ${displayNumber(Number(body["limit"]))} levels`;

export function queryErrorText(body: ErrorBody): string {
  switch (body.error) {
    case "unknown_operator":
      return `Unknown operator ${String(body["operator"])}`;
    case "invalid_projection":
      return "Projection cannot mix inclusion and exclusion";
    case "scan_limit":
      return guardText(body);
    case "query_too_deep":
      return deepText(body);
    case "invalid_query": {
      const field = String(body["field"]);
      if (field === "limit") return "Limit must be a whole number of 0 or more";
      if (field === "page") return "Page must be a whole number of 1 or more";
      return `${FIELD_NAMES[field] ?? "Query"} is not valid`;
    }
    default:
      return "Query not run";
  }
}

export function pipelineErrorText(body: ErrorBody): string {
  switch (body.error) {
    case "too_many_stages":
      return `Pipeline has more than ${displayNumber(Number(body["limit"]))} stages`;
    case "unknown_stage":
      return `Unknown stage ${String(body["stage"])}`;
    case "invalid_stage":
      return `Stage ${displayNumber(Number(body["index"]) + 1)} is not valid`;
    case "scan_limit":
      return guardText(body);
    case "query_too_deep":
      return deepText(body);
    case "not_found":
      return "No document in this collection has that _id";
    default:
      return "The pipeline could not run";
  }
}
