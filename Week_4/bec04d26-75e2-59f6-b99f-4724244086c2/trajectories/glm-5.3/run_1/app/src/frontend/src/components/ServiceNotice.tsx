import { useEffect, useState } from 'react';

export interface ServiceState {
  mailUp: boolean;
  pdfUp: boolean;
}

const MAIL_BANNER = "Reminders are waiting: mail can't be reached right now.";
const PDF_BANNER = "Packets are waiting: the PDF service can't be reached right now.";

export function useServiceState(): { service: ServiceState; node: React.ReactNode } {
  const [service, setService] = useState<ServiceState>({ mailUp: true, pdfUp: true });

  useEffect(() => {
    const check = async () => {
      try {
        const response = await fetch('/api/health');
        const body = (await response.json()) as { status: string };
        setService({ mailUp: body.status === 'ok', pdfUp: body.status === 'ok' });
      } catch {
        setService({ mailUp: false, pdfUp: false });
      }
    };
    void check();
    const timer = setInterval(check, 2000);
    return () => clearInterval(timer);
  }, []);

  const node = service.mailUp && service.pdfUp ? null : (
    <div className="service-notice" role="region" aria-label="Service notice">
      {!service.mailUp ? <p className="banner">{MAIL_BANNER}</p> : null}
      {!service.pdfUp ? <p className="banner">{PDF_BANNER}</p> : null}
    </div>
  );
  return { service, node };
}
