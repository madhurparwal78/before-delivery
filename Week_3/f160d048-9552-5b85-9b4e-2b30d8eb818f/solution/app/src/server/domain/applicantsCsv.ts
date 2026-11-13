type CsvApplicant = { id: string; candidate_name: string; job_title: string; stage: string; applied_at: Date; updated_at: Date };

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const day = (moment: Date): string => moment.toISOString().slice(0, 10);

const CSV_HEADER = ["application_id", "candidate_name", "job_title", "stage", "applied_on", "updated_on"];

/** UTF-8, CRLF line ends, no byte order mark; the caller supplies the applicants newest applied first. */
export function applicantsCsv(applicants: CsvApplicant[]): string {
  const lines = [
    CSV_HEADER.join(","),
    ...applicants.map((applicant) =>
      [applicant.id, applicant.candidate_name, applicant.job_title, applicant.stage, day(applicant.applied_at), day(applicant.updated_at)]
        .map(cell)
        .join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
